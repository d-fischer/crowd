import path from 'path';
import toposort from 'toposort';
import type { PackageJson } from 'type-fest';
import type { ParsedCommandLine, ProjectReference } from 'typescript';
import { parseConfig } from './utils/typescript.js';

interface Package {
	name: string;
	basePath: string;
	references: readonly ProjectReference[];
	dependencies: Partial<Record<string, string>>;
}

export class Solution {
	private _rootConfig?: ParsedCommandLine;
	private _packageMap?: Map<string, Package>;

	constructor(private readonly _rootPath: string) {}

	async listPackages(useToposort: boolean = false): Promise<string[]> {
		const packageMap = await this._getPackageMap();
		const packageNames = Array.from(packageMap.keys());

		if (!useToposort) {
			return packageNames;
		}

		const packages = Array.from(packageMap.values());
		const pathToPackageName = new Map(packages.map(pkg => [pkg.basePath, pkg.name]));

		const dependencyPairs = packages.flatMap(pkg =>
			pkg.references.map((ref): [string, string] => [ref.path, pkg.basePath])
		);

		return toposort(dependencyPairs).map(name => pathToPackageName.get(name)!);
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
							dependencies: packageJson.dependencies ?? {}
						}
					] as const;
				})
			)
		));
	}

	private _getRootConfig(): ParsedCommandLine {
		if (this._rootConfig) {
			return this._rootConfig;
		}

		return (this._rootConfig = parseConfig(path.join(this._rootPath, 'tsconfig.json')));
	}
}
