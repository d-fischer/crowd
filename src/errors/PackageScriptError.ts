import type { Package } from '../deps/DependencyGraph.js';

export class PackageScriptError extends Error {
	constructor(pkg: Package, public readonly code: number, public readonly stderr: string, options?: ErrorOptions) {
		super(`Script for package ${pkg.name} failed with exit code ${code}; output:\n\n${stderr}`, options);
		this.name = this.constructor.name;
	}
}
