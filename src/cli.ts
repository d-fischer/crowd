/* eslint-disable no-console */
import { boolean, command, flag, positional, run, string, subcommands } from 'cmd-ts';
import { Solution } from './Solution.js';

const app = subcommands({
	name: 'crowd',
	cmds: {
		list: command({
			name: 'list',
			args: {
				toposort: flag({
					type: boolean,
					long: 'toposort',
					short: 't',
					description: 'topologically sort the packages based on the dependency graph'
				})
			},
			handler: async ({ toposort }) => {
				const solution = new Solution(process.cwd());
				console.log((await solution.listPackages(toposort)).join('\n'));
			}
		}),
		run: command({
			name: 'run',
			args: {
				scriptName: positional({
					type: string,
					displayName: 'scriptName',
					description: 'the name of the script to run'
				})
			},
			handler: async ({ scriptName }) => {
				const solution = new Solution(process.cwd());
				await solution.runScriptInAllPackages(scriptName);
			}
		})
	}
});

await run(app, process.argv.slice(2));
