import type { Package } from '../deps/DependencyGraph.js';

export class GraphTaskError extends Error {
	constructor(pkg: Package, public readonly code: string, public readonly additionalInfo?: string, cause?: Error) {
		super(`Task for package ${pkg.name} failed: ${cause?.message ?? code}`, { cause });
		this.name = this.constructor.name;
	}
}
