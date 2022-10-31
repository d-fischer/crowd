import path from 'path';
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

export class Solution {
	private _rootConfig?: ParsedCommandLine;
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

		/* eslint-disable no-console */
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
		/* eslint-enable no-console */
	}

	private async _getPackageMap(): Promise<Map<string, Package>> {
		if (this._packageMap) {
			return this._packageMap;
		}

		return (this._packageMap = new Map(
			await Promise.all(
				this._getRootConfig().projectReferences!.map(async (ref): Promise<readonly [string, Package]> => {
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

	private _getRootConfig(): ParsedCommandLine {
		return (this._rootConfig ??= parseConfig(path.join(this._rootPath, 'tsconfig.json')));
	}
}
