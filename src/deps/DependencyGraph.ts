import type { PackageJson } from 'type-fest';
import type { ProjectReference } from 'typescript';
import { GraphTaskError } from '../errors/GraphTaskError.js';
import type { GraphErrorInfo } from '../errors/GraphError.js';
import { GraphError } from '../errors/GraphError.js';

export interface Package {
	name: string;
	basePath: string;
	references: readonly ProjectReference[];
	packageJson: PackageJson;
	rawPackageJson: string;
	combinedDependencies: Partial<Record<string, string>>;
}

export interface PackageNode {
	pkgName: string;
	children: PackageNode[];
}

export interface GraphResult {
	status: string;
	additionalInfo?: string;
	shouldChildrenFail?: boolean;
}

export class DependencyGraph {
	private readonly _roots: Map<string, PackageNode>;
	private readonly _nodes: Map<string, PackageNode>;

	private _cyclesChecked = false;

	constructor(private readonly _packageMap: Map<string, Package>) {
		const packageNames = Array.from(_packageMap.keys());
		this._nodes = new Map<string, PackageNode>(packageNames.map(pkgName => [pkgName, { pkgName, children: [] }]));
		this._roots = new Map(this._nodes);
		for (const packageName of packageNames) {
			const pkg = _packageMap.get(packageName)!;
			const pkgNode = this._nodes.get(packageName)!;
			for (const dependencyName of Object.keys(pkg.combinedDependencies)) {
				if (packageNames.includes(dependencyName)) {
					pkgNode.children.push(this._nodes.get(dependencyName)!);
					this._roots.delete(dependencyName);
				}
			}
		}
	}

	checkCycles() {
		if (!this._cyclesChecked) {
			this._roots.forEach(child => this._checkCyclesInSubgraph(child, []));
			this._cyclesChecked = true;
		}
	}

	toposort(): string[] {
		this.checkCycles();
		const result: string[] = [];
		const roots = [...this._roots.keys()];
		const allDependencies = new Map(
			Array.from(this._nodes.entries()).map(([name, entry]) => [name, entry.children.map(child => child.pkgName)])
		);

		while (roots.length) {
			const n = roots.shift()!;
			result.push(n);
			for (const m of this._nodes.get(n)!.children) {
				let foundOther = false;
				for (const [key, deps] of allDependencies) {
					if (deps.includes(m.pkgName)) {
						if (key === n) {
							allDependencies.set(
								key,
								deps.filter(dep => dep !== m.pkgName)
							);
						} else {
							foundOther = true;
						}
					}
				}
				if (!foundOther) {
					roots.push(m.pkgName);
				}
			}
		}

		if (Array.from(allDependencies.values()).some(deps => deps.length > 0)) {
			throw new Error('unknown cycle detected - this should never happen');
		}

		return result;
	}

	getPackages(): Package[] {
		return Array.from(this._packageMap.values());
	}

	filter(predicate: (pkg: Package) => boolean): Package[] {
		return this.getPackages().filter(predicate);
	}

	async walkAsync(
		callback: (pkg: Package) => Promise<GraphResult | undefined>,
		errorCallback?: (err: Error, pkg: Package) => void,
		skipPackages?: string[]
	): Promise<void> {
		const promiseCache = new Map<PackageNode, Promise<GraphResult>>();
		let errorCount = 0;
		let lastErrorInfo: GraphErrorInfo | null = null;

		/* eslint-disable @typescript-eslint/return-await */
		const visit = async (node: PackageNode): Promise<GraphResult> => {
			if (promiseCache.has(node)) {
				return promiseCache.get(node)!;
			}
			const pkg = this._packageMap.get(node.pkgName)!;
			const promise = Promise.all(node.children.map(visit)).then(async (childResults): Promise<GraphResult> => {
				const skipThisPackage = skipPackages?.includes(pkg.name);
				if (childResults.some(res => res.shouldChildrenFail)) {
					if (!skipThisPackage) {
						errorCallback?.(new GraphTaskError(pkg, 'skipped', 'dependency failure'), pkg);
					}
					return {
						status: 'skipped',
						additionalInfo: 'dependency failure',
						shouldChildrenFail: true
					};
				}
				if (skipThisPackage) {
					return { status: 'success' };
				}
				return callback(pkg).then(
					result => result ?? { status: 'success' },
					e => {
						errorCallback?.(e, pkg);
						errorCount++;
						lastErrorInfo = { error: e as Error, package: pkg };
						return {
							status: 'error',
							shouldChildrenFail: true
						};
					}
				);
			});
			promiseCache.set(node, promise);
			return promise;
		};

		await Promise.all(Array.from(this._roots.values()).map(async root => visit(root)));
		/* eslint-enable @typescript-eslint/return-await */

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (lastErrorInfo) {
			throw new GraphError(lastErrorInfo, errorCount);
		}
	}

	private _checkCyclesInSubgraph(node: PackageNode, ancestors: string[]) {
		const found = ancestors.findIndex(ancestor => node.pkgName === ancestor);
		if (found !== -1) {
			throw new Error(`dependency cycle detected: ${[...ancestors.slice(found), node.pkgName].join(' -> ')}`);
		}
		node.children.forEach(child => this._checkCyclesInSubgraph(child, [...ancestors, node.pkgName]));
	}
}
