import { spawn } from 'cross-spawn';
import { ExecutionError } from '../errors/ExecutionError.js';

export interface ExecProcessOptions {
	cwd?: string;
	interactive?: boolean;
}

export async function execProcess(cmd: string, args: string[] = [], options: ExecProcessOptions = {}): Promise<string> {
	const { cwd, interactive } = options;

	return await new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, {
			cwd,
			stdio: interactive ? 'inherit' : 'pipe',
			shell: options.interactive
		});

		let output = '';
		let errOutput = '';

		proc.stdout?.on('data', data => {
			output += data;
		});

		proc.stderr?.on('data', data => {
			errOutput += data;
		});

		proc.on('close', err => {
			if (err) {
				reject(new ExecutionError(cmd, args, err, errOutput));
			} else {
				resolve(output.trimEnd());
			}
		});
	});
}
