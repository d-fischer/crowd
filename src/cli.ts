import { boolean, command, flag, positional, rest, run, string, subcommands } from 'cmd-ts';
import kleur from 'kleur';
import prompts from 'prompts';
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
				}),
				noProgress: flag({
					type: boolean,
					long: 'no-progress',
					short: 'P',
					description: 'disable detailed progress of separate packages'
				})
			},
			handler: async ({ scriptName, args, noProgress }) => {
				const solution = new Solution(process.cwd());
				try {
					const anyExecuted = await solution.runScriptInAllPackages(scriptName, args, !noProgress);
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
				}),
				commitStaged: flag({
					type: boolean,
					long: 'commit-staged',
					short: 's',
					description:
						'Adds the currently staged changes to the version commit. If this is not used, the command will fail if there are any staged changes.'
				}),
				yes: flag({
					type: boolean,
					long: 'yes',
					short: 'y',
					description: 'Skips all interactive confirmations.'
				})
			},
			handler: async ({ releaseType, commitStaged, yes }) => {
				if (!VALID_RELEASE_TYPES.includes(releaseType)) {
					console.error(
						`Invalid release type given: ${releaseType}\n\nValid types: ${VALID_RELEASE_TYPES.join(', ')}`
					);
					process.exit(1);
				}

				const solution = new Solution(process.cwd());
				try {
					const { oldVersion, newVersion } = await solution.getVersionBump(releaseType as ReleaseType);

					if (!yes) {
						console.log('This command will:');
						console.log(
							`- Update all your package.json files from version ${kleur.cyan(
								oldVersion
							)} to ${kleur.cyan(newVersion)} (including dependencies) as well as your crowd.json file`
						);
						let commitBulletPoint = '- Create a commit with the above changes';
						if (commitStaged) {
							commitBulletPoint += kleur.cyan(' and any changes already in the git index');
						}
						console.log(commitBulletPoint);
						console.log(`- Tag the commit as ${kleur.cyan(`v${newVersion}`)}`);
						console.log(
							`- Run the ${kleur.cyan(
								'preversion, version and postversion'
							)} scripts in all packages and in the root at the appropriate times`
						);

						const { confirmed } = (await prompts({
							type: 'confirm',
							name: 'confirmed',
							message: 'Is that okay?',
							initial: false
						})) as { confirmed: boolean };

						if (!confirmed) {
							console.error('Aborted by user.');
							process.exit(1);
						}
					}

					await solution.updateVersion(newVersion, { commitStaged });

					console.log(`Updated version from ${kleur.cyan(oldVersion)} to ${kleur.cyan(newVersion)}`);
				} catch (e) {
					handleError(e);
				}
			}
		})
	}
});

await run(app, process.argv.slice(2));
