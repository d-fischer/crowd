import { promises as fs } from 'fs';
import path from 'path';
import type { ReleaseType } from 'semver';
import type { PackageJson } from 'type-fest';
import type { ParsedCommandLine } from 'typescript';
import type { Package } from './deps/DependencyGraph.js';
import { DependencyGraph } from './deps/DependencyGraph.js';
import { parseConfig } from './utils/typescript.js';
import { render } from 'ink';
import { GraphWalker } from './components/GraphWalker.js';
import React from 'react';
import kleur from 'kleur';
import { GraphError } from './errors/GraphError.js';
import { spawn } from 'child_process';
import { ScriptError } from './errors/ScriptError.js';
import semver from 'semver';

interface CrowdConfig {
	currentVersion: string;
	preVersionScripts: string[];
	prereleaseIdentifier?: string;
	commitMessageTemplate?: string;
}

export class Solution {
	private _crowdConfig?: CrowdConfig;
	private _rootTsConfig?: ParsedCommandLine;
	private _packageMap?: Map<string, Package>;

	constructor(private readonly _rootPath: string) {}

	async listPackages(useToposort: boolean = true): Promise<string[]> {
		const packageMap = await this._getPackageMap();
		const packageNames = Array.from(packageMap.keys());

		if (!useToposort) {
			return packageNames;
		}

		const depGraph = new DependencyGraph(packageMap);
		return depGraph.toposort().reverse();
	}

	async runScriptInAllPackages(scriptName: string, args: string[]) {
		const packageMap = await this._getPackageMap();
		const depGraph = new DependencyGraph(packageMap);
		depGraph.checkCycles();

		const app = render(
			React.createElement(GraphWalker, {
				graph: depGraph,
				exec: async pkg => {
					if (!pkg.packageJson.scripts?.[scriptName]) {
						return {
							status: 'skipped',
							shouldChildrenFail: false,
							additionalInfo: 'script not found'
						};
					}
					await new Promise<void>((resolve, reject) => {
						const proc = spawn('yarn', ['run', scriptName, ...args], {
							cwd: pkg.basePath
						});

						let errOutput = '';

						proc.stderr.on('data', data => {
							errOutput += data;
						});

						proc.on('close', err => {
							if (err) {
								reject(new ScriptError(pkg, err, errOutput));
							} else {
								resolve();
							}
						});
					});

					return undefined;
				}
			})
		);

		try {
			await app.waitUntilExit();
			console.log(kleur.cyan('Finished running command for all packages'));
		} catch (e) {
			if (e instanceof GraphError) {
				console.error(kleur.red(`${e.errorCount} package(s) failed building; last error:`));
				console.error(e.lastErrorInfo.error.stack ?? e.lastErrorInfo.error.message);
			} else {
				console.error(kleur.red('Something went wrong:'));
				if (e instanceof Error) {
					console.error(e.stack ?? e.message);
				} else {
					console.error(e);
				}
			}
			process.exit(1);
		}
	}

	async bumpVersion(type: ReleaseType) {
		const config = await this._getConfig();
		const currentVersion = semver.valid(config.currentVersion);
		if (!currentVersion) {
			console.error(`Invalid version set in config: ${config.currentVersion}`);
			process.exit(1);
		}

		// TODO run pre version scripts

		const newVersion = semver.inc(currentVersion, type, config.prereleaseIdentifier)!;
		const commitMessage = config.commitMessageTemplate
			? config.commitMessageTemplate.replace('%s', newVersion)
			: newVersion;

		// TODO actually modify package.json and config files, git add/commit/push them, remove msg from log

		console.log(`Bumped version: ${currentVersion} -> ${newVersion} (msg: ${commitMessage})`);
	}

	private async _getPackageMap(): Promise<Map<string, Package>> {
		if (this._packageMap) {
			return this._packageMap;
		}

		return (this._packageMap = new Map(
			await Promise.all(
				this._getRootTsConfig().projectReferences!.map(async (ref): Promise<readonly [string, Package]> => {
					const packageJson = (
						(await import(path.join(ref.path, 'package.json'), { assert: { type: 'json' } })) as {
							default: PackageJson;
						}
					).default;
					const tsConfig = parseConfig(path.join(ref.path, 'tsconfig.json'));
					const name = packageJson.name!;
					return [
						name,
						{
							name,
							basePath: ref.path,
							references: tsConfig.projectReferences ?? [],
							packageJson,
							combinedDependencies: {
								...packageJson.dependencies,
								...packageJson.devDependencies
							}
						}
					] as const;
				})
			)
		));
	}

	private _getRootTsConfig(): ParsedCommandLine {
		return (this._rootTsConfig ??= parseConfig(path.join(this._rootPath, 'tsconfig.json')));
	}

	private async _getConfig(): Promise<CrowdConfig> {
		if (this._crowdConfig) {
			return this._crowdConfig;
		}

		const data = JSON.parse(
			await fs.readFile(path.join(this._rootPath, 'crowd.json'), 'utf-8').catch(() => '{}')
		) as Partial<CrowdConfig>;

		return (this._crowdConfig = {
			currentVersion: data.currentVersion ?? '0.0.0',
			preVersionScripts: data.preVersionScripts ?? [],
			prereleaseIdentifier: data.prereleaseIdentifier,
			commitMessageTemplate: data.commitMessageTemplate
		});
	}
}
