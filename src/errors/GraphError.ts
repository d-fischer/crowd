import type { Package } from '../deps/DependencyGraph.js';

export interface GraphErrorInfo {
	error: Error;
	package: Package;
}

export class GraphError extends Error {
	constructor(public readonly lastErrorInfo: GraphErrorInfo, public readonly errorCount: number) {
		super(`Task for package ${lastErrorInfo.package.name} failed: ${lastErrorInfo.error.message}`, {
			cause: lastErrorInfo.error
		});
		this.name = this.constructor.name;
	}
}

Object.defineProperty(GraphError.prototype, 'lastErrorInfo', { writable: true, enumerable: false });
