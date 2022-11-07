import { spawn } from 'child_process';
import { ExecutionError } from '../errors/ExecutionError.js';

export async function execProcess(cmd: string, args: string[] = [], cwd?: string): Promise<string> {
	return await new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { cwd });

		let output = '';
		let errOutput = '';

		proc.stdout.on('data', data => {
			output += data;
		});

		proc.stderr.on('data', data => {
			errOutput += data;
		});

		proc.on('close', err => {
			if (err) {
				reject(new ExecutionError(err, errOutput));
			} else {
				resolve(output.trimEnd());
			}
		});
	});
}
