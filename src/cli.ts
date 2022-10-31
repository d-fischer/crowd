import { boolean, command, flag, positional, rest, run, string, subcommands } from 'cmd-ts';
import kleur from 'kleur';
import type { ReleaseType } from 'semver';
import { GraphError } from './errors/GraphError.js';
import { Solution } from './Solution.js';

const VALID_RELEASE_TYPES = ['major', 'premajor', 'minor', 'preminor', 'patch', 'prepatch', 'prerelease'];

function handleError(e: unknown) {
	if (e instanceof GraphError) {
		console.error(kleur.red(`${e.errorCount} package(s) failed building; last error:`));
		console.error(e.lastErrorInfo.error.stack ?? e.lastErrorInfo.error.message);
	} else {
		console.error(kleur.red('Something went wrong:'));
		if (e instanceof Error) {
			console.error(e.stack ?? e.message);
		} else {
			console.error(e);
		}
	}
	process.exit(1);
}

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
				const solution = new Solution(process.cwd());
				try {
					const anyExecuted = await solution.runScriptInAllPackages(scriptName, args, true);
					if (!anyExecuted) {
						process.exit(1);
					}
				} catch (e) {
					handleError(e);
				}
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
				try {
					await solution.bumpVersion(releaseType as ReleaseType);
				} catch (e) {
					handleError(e);
				}
			}
		})
	}
});

await run(app, process.argv.slice(2));
