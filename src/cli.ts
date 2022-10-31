import { boolean, command, flag, positional, rest, run, string, subcommands } from 'cmd-ts';
import type { ReleaseType } from 'semver';
import { Solution } from './Solution.js';
import kleur from 'kleur';

const VALID_RELEASE_TYPES = ['major', 'premajor', 'minor', 'preminor', 'patch', 'prepatch', 'prerelease'];

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
		}),
		version: command({
			name: 'version',
			args: {
				releaseType: positional({
					type: string,
					displayName: 'releaseType',
					description:
						'The release type of the version bump. Determines which part of the version number will increase.'
				})
			},
			handler: async ({ releaseType }) => {
				if (!VALID_RELEASE_TYPES.includes(releaseType)) {
					console.error(
						`Invalid release type given: ${releaseType}\n\nValid types: ${VALID_RELEASE_TYPES.join(', ')}`
					);
					process.exit(1);
				}

				const solution = new Solution(process.cwd());
				await solution.bumpVersion(releaseType as ReleaseType);
			}
		})
	}
});

await run(app, process.argv.slice(2));
