import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { render } from 'ink';
import kleur from 'kleur';
import path from 'path';
import React from 'react';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import type { PackageJson } from 'type-fest';
import type { ParsedCommandLine } from 'typescript';
import { GraphWalker } from './components/GraphWalker.js';
import type { Package } from './deps/DependencyGraph.js';
import { DependencyGraph } from './deps/DependencyGraph.js';
import { GraphError } from './errors/GraphError.js';
import { ScriptError } from './errors/ScriptError.js';
import { parseConfig } from './utils/typescript.js';

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

	async runScriptInAllPackages(scriptName: string, args: string[], withProgress = false) {
		const packageMap = await this._getPackageMap();
		const depGraph = new DependencyGraph(packageMap);
		depGraph.checkCycles();

		const skipPackages = depGraph.filter(pkg => !pkg.packageJson.scripts?.[scriptName]).map(pkg => pkg.name);
		const packageCountToRun = packageMap.size - skipPackages.length;

		if (packageCountToRun === 0) {
			console.error(`could not find script ${kleur.cyan(scriptName)} in any of your packages, exiting`);
			process.exit(1);
		}

		console.log(`running script ${kleur.cyan(`${[scriptName, ...args].join(' ')}`)} in all packages`);

		async function exec(pkg: Package) {
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

		try {
			if (withProgress) {
				const app = render(
					React.createElement(GraphWalker, {
						graph: depGraph,
						exec,
						skipPackages
					})
				);
				await app.waitUntilExit();
			} else {
				await depGraph.walkAsync(exec, undefined, skipPackages);
			}
			console.log(
				`Finished running the script ${kleur.cyan(scriptName)} for ${kleur.cyan(
					packageCountToRun
				)} packages (skipped ${kleur.yellow(skipPackages.length)} packages that don't have this script)`
			);
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
