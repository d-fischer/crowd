export class ExecutionError extends Error {
	constructor(public readonly code: number, public readonly stderr: string) {
		super(`Execution failed with exit code ${code}; output:\n\n${stderr}`);
		this.name = this.constructor.name;
	}
}
