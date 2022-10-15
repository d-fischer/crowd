import path from 'path';
import type { PackageJson } from 'type-fest';
import type { ParsedCommandLine } from 'typescript';
import type { Package } from './deps/DependencyGraph.js';
import { DependencyGraph } from './deps/DependencyGraph.js';
import { parseConfig } from './utils/typescript.js';

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

	async runScriptInAllPackages(scriptName: string) {
		const packageMap = await this._getPackageMap();
		const depGraph = new DependencyGraph(packageMap);
		depGraph.checkCycles();

		await depGraph.walkAsync(async pkg => {
			// TODO actually run scripts...
			/* eslint-disable no-console */
			console.log('start', scriptName, pkg.name);
			await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 500));
			console.log('stop', scriptName, pkg.name);
			/* eslint-enable no-console */
		});
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
