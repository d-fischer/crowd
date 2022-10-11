/* eslint-disable no-console */
import { boolean, command, flag, run, subcommands } from 'cmd-ts';
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
					description: 'topologically sort the packages based on the dependency tree'
				})
			},
			handler: async ({ toposort }) => {
				const solution = new Solution(process.cwd());
				console.log((await solution.listPackages(toposort)).join('\n'));
			}
		})
	}
});

await run(app, process.argv.slice(2));
