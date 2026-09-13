export class ExecutionError extends Error {
	constructor(
		public readonly cmd: string,
		public readonly args: string[],
		public readonly code: number,
		public readonly stderr: string
	) {
		super(`Execution of \`${cmd} ${args.join(' ')}\` failed with exit code ${code}; output:\n\n${stderr}`);
		this.name = this.constructor.name;
	}
}
