/* eslint-disable no-console */
import { boolean, command, flag, positional, rest, run, string, subcommands } from 'cmd-ts';
import { Solution } from './Solution.js';
import kleur from 'kleur';

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
				}),
				args: rest({
					displayName: 'args',
					description: 'arguments to pass to the script'
				})
			},
			handler: async ({ scriptName, args }) => {
				console.log(`running script ${kleur.cyan(`${[scriptName, ...args].join(' ')}`)} in all packages`);
				const solution = new Solution(process.cwd());
				await solution.runScriptInAllPackages(scriptName, args);
			}
		})
	}
});

await run(app, process.argv.slice(2));
