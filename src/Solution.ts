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
import { PackageScriptError } from './errors/PackageScriptError.js';
import { ExecutionError } from './errors/ExecutionError.js';
import { runLifecycle } from './utils/lifecycle.js';
import { parseConfig } from './utils/typescript.js';
import detectIndent from 'detect-indent';
import { execProcess } from './utils/process.js';

interface CrowdConfig {
	currentVersion: string;
	prereleaseIdentifier?: string;
	commitMessageTemplate?: string;
}

interface BumpVersionOptions {
	commitStaged: boolean;
}

export class Solution {
	private _crowdConfig?: CrowdConfig;
	private _crowdConfigRaw?: string;
	private _rootTsConfig?: ParsedCommandLine;
	private _rootPackageJson?: PackageJson;
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

	async runScriptInAllPackagesWithRoot(scriptName: string, args: string[] = []) {
		await this.runScriptInAllPackages(scriptName, args, false);
		const rootPackage = await this._getRootPackageJson();
		if (rootPackage.scripts?.preversion) {
			await runLifecycle(this._rootPath, scriptName, args);
		}
	}

	async runScriptInAllPackages(scriptName: string, args: string[] = [], withProgress = false) {
		const packageMap = await this._getPackageMap();
		const depGraph = new DependencyGraph(packageMap);
		depGraph.checkCycles();

		const skipPackages = depGraph.filter(pkg => !pkg.packageJson.scripts?.[scriptName]).map(pkg => pkg.name);
		const packageCountToRun = packageMap.size - skipPackages.length;

		if (packageCountToRun === 0) {
			console.error(`could not find script ${kleur.cyan(scriptName)} in any of your packages`);
			return false;
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
			try {
				await runLifecycle(pkg.basePath, scriptName, args);
			} catch (e: unknown) {
				throw e instanceof ExecutionError ? new PackageScriptError(pkg, e.code, e.stderr, { cause: e }) : e;
			}

			return undefined;
		}

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
		let msg = `Finished running the script ${kleur.cyan(scriptName)} for ${kleur.cyan(packageCountToRun)} packages`;

		if (skipPackages.length > 0) {
			msg += ` (skipped ${kleur.yellow(skipPackages.length)} packages that don't have this script)`;
		}

		console.log(msg);
		return true;
	}

	async bumpVersion(type: ReleaseType, options: BumpVersionOptions) {
		const { parsed: config, raw: rawConfig } = await this._getConfig();
		const currentVersion = semver.valid(config.currentVersion);
		if (!currentVersion) {
			console.error(`Invalid version set in config: ${config.currentVersion}`);
			process.exit(1);
		}

		if (!options.commitStaged) {
			try {
				await execProcess('git', ['diff', '--quiet', '--cached'], this._rootPath);
			} catch (e) {
				console.error(`There are staged changes in your git repository.
				
Please stash them or rerun this command with ${kleur.cyan('--commit-staged')} to keep them in your version commit.`);
				process.exit(1);
			}
		}

		await this.runScriptInAllPackagesWithRoot('preversion');

		const newVersion = semver.inc(currentVersion, type, config.prereleaseIdentifier)!;
		const commitMessage = config.commitMessageTemplate
			? config.commitMessageTemplate.replace('%s', newVersion)
			: newVersion;

		const changedFiles = new Set<string>();
		for (const pkg of (await this._getPackageMap()).values()) {
			const newPackageJson: PackageJson = {
				...pkg.packageJson
			};

			newPackageJson.version = newVersion;

			if (pkg.packageJson.dependencies) {
				newPackageJson.dependencies = await this._modifyDependencyObject(
					pkg.packageJson.dependencies,
					newVersion
				);
			}
			if (pkg.packageJson.peerDependencies) {
				newPackageJson.peerDependencies = await this._modifyDependencyObject(
					pkg.packageJson.peerDependencies,
					newVersion
				);
			}
			if (pkg.packageJson.devDependencies) {
				newPackageJson.devDependencies = await this._modifyDependencyObject(
					pkg.packageJson.devDependencies,
					newVersion
				);
			}

			const packageJsonPath = path.join(pkg.basePath, 'package.json');
			const modified = await this._modifyJsonFile(packageJsonPath, pkg.rawPackageJson, newPackageJson);

			if (modified) {
				changedFiles.add(path.relative(this._rootPath, packageJsonPath));
			}
		}

		const newCrowdConfig: CrowdConfig = {
			...(await this._getConfig()).parsed,
			currentVersion: newVersion
		};
		const modified = await this._modifyJsonFile(path.join(this._rootPath, 'crowd.json'), rawConfig, newCrowdConfig);

		if (modified) {
			changedFiles.add('crowd.json');
		}

		await this._gitAdd(Array.from(changedFiles));

		await this.runScriptInAllPackagesWithRoot('version');

		await execProcess('git', ['commit', '-m', commitMessage], this._rootPath);
		await execProcess('git', ['tag', `v${newVersion}`], this._rootPath);

		await this.runScriptInAllPackagesWithRoot('postversion');

		// TODO git push?

		console.log(`Bumped version: ${currentVersion} -> ${newVersion}`);
	}

	private async _getPackageMap(): Promise<Map<string, Package>> {
		if (this._packageMap) {
			return this._packageMap;
		}

		return (this._packageMap = new Map(
			await Promise.all(
				this._getRootTsConfig().projectReferences!.map(async (ref): Promise<readonly [string, Package]> => {
					const { raw: rawPackageJson, parsed: packageJson } = await this._getPackageJson(ref.path);
					const tsConfig = parseConfig(path.join(ref.path, 'tsconfig.json'));
					const name = packageJson.name!;
					return [
						name,
						{
							name,
							basePath: ref.path,
							references: tsConfig.projectReferences ?? [],
							packageJson,
							rawPackageJson,
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

	private async _getRootPackageJson(): Promise<PackageJson> {
		if (this._rootPackageJson) {
			return this._rootPackageJson;
		}

		return (this._rootPackageJson = await this._getPackageJson(this._rootPath));
	}

	private async _modifyJsonFile(filePath: string, origRaw: string, newData: unknown) {
		const { indent } = detectIndent(origRaw);
		const newRaw = `${JSON.stringify(newData, undefined, indent)}\n`;
		if (origRaw === newRaw) {
			return false;
		}
		await fs.writeFile(filePath, newRaw);
		return true;
	}

	private async _getPackageJson(folderPath: string) {
		const filePath = path.join(folderPath, 'package.json');
		const raw = await fs.readFile(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as PackageJson;

		return { raw, parsed };
	}

	private async _modifyDependencyObject(
		deps: PackageJson.Dependency,
		newVersion: string
	): Promise<PackageJson.Dependency> {
		const packageMap = await this._getPackageMap();
		return Object.fromEntries(
			Object.entries(deps).map(([name, version]) => {
				if (!packageMap.has(name)) {
					return [name, version];
				}
				return [name, newVersion];
			})
		);
	}

	private _getRootTsConfig(): ParsedCommandLine {
		return (this._rootTsConfig ??= parseConfig(path.join(this._rootPath, 'tsconfig.json')));
	}

	private async _getConfig() {
		if (this._crowdConfig) {
			return {
				raw: this._crowdConfigRaw!,
				parsed: this._crowdConfig
			};
		}

		const raw = await fs.readFile(path.join(this._rootPath, 'crowd.json'), 'utf-8').catch(() => '{}');
		const data = JSON.parse(raw) as Partial<CrowdConfig>;

		this._crowdConfigRaw = raw;
		this._crowdConfig = {
			currentVersion: data.currentVersion ?? '0.0.0',
			prereleaseIdentifier: data.prereleaseIdentifier,
			commitMessageTemplate: data.commitMessageTemplate
		};

		return {
			raw,
			parsed: this._crowdConfig
		};
	}

	private async _gitAdd(files: string[]) {
		await execProcess('git', ['add', '--', ...files], this._rootPath);
	}
}
