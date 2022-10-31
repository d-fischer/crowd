import type { Package } from '../deps/DependencyGraph.js';

export class ScriptError extends Error {
	constructor(pkg: Package, public readonly code: number, public readonly stderr: string) {
		super(`Task for package ${pkg.name} failed with exit code ${code}; output:\n\n${stderr}`);
		this.name = this.constructor.name;
	}
}
