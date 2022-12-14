import type { DependencyGraph, GraphResult, Package } from '../deps/DependencyGraph.js';
import type { ReactElement } from 'react';
import React, { useEffect, useState } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { GraphTaskError } from '../errors/GraphTaskError.js';

export interface GraphWalkerProps {
	graph: DependencyGraph;
	exec: (pkg: Package) => Promise<GraphResult | undefined>;
	skipPackages?: string[];
	linear?: boolean;
}

interface ResultInfo {
	package: string;
	error?: Error;
	result?: GraphResult;
}

export const GraphWalker = ({ graph, exec, skipPackages, linear }: GraphWalkerProps): ReactElement => {
	const [runningEntries, setRunningEntries] = useState<string[]>([]);
	const [finishedEntries, setFinishedEntries] = useState<ResultInfo[]>([]);

	const { exit } = useApp();

	useEffect(() => {
		if (linear) {
			void (async () => {
				let errors = 0;
				for (const pkg of graph.getPackages()) {
					setRunningEntries(prev => [...prev, pkg.name]);
					try {
						const result = await exec(pkg);
						setFinishedEntries(prev => [...prev, { package: pkg.name, result }]);
						setRunningEntries(prev => prev.filter(item => item !== pkg.name));
					} catch (e) {
						errors++;
						setFinishedEntries(prev => [...prev, { package: pkg.name, error: e as Error }]);
						setRunningEntries(prev => prev.filter(item => item !== pkg.name));
					}
				}
				if (errors) {
					exit(new Error(`Error processing ${errors} packages; please check the result manually`));
				} else {
					exit();
				}
			})();
		} else {
			void graph
				.walkAsync(
					async (pkg): Promise<GraphResult | undefined> => {
						setRunningEntries(prev => [...prev, pkg.name]);
						const result = await exec(pkg);
						setFinishedEntries(prev => [...prev, { package: pkg.name, result }]);
						setRunningEntries(prev => prev.filter(item => item !== pkg.name));
						return result;
					},
					(e, pkg) => {
						setFinishedEntries(prev => [...prev, { package: pkg.name, error: e }]);
						setRunningEntries(prev => prev.filter(item => item !== pkg.name));
					},
					skipPackages
				)
				.then(
					() => exit(),
					e => exit(e)
				);
		}
	}, [graph, exec, linear]);

	return (
		<Box flexDirection="column">
			<Static items={finishedEntries}>
				{item =>
					item.error ? (
						item.error instanceof GraphTaskError && item.error.code === 'skipped' ? (
							<Text key={item.package} color="yellow">
								? {item.package} skipped
								{item.error.additionalInfo ? ` (${item.error.additionalInfo})` : ''}
							</Text>
						) : (
							<Text key={item.package} color="red">
								{'\u2717'} {item.package}
							</Text>
						)
					) : item.result ? (
						item.result.status === 'skipped' ? (
							<Text key={item.package} color="yellow">
								? {item.package} skipped
								{item.result.additionalInfo ? ` (${item.result.additionalInfo})` : ''}
							</Text>
						) : item.result.status === 'success' ? (
							<Text key={item.package} color="green">
								{'\u2713'} {item.package}
							</Text>
						) : item.result.status === 'error' ? (
							<Text key={item.package} color="red">
								{'\u2717'} {item.package}
							</Text>
						) : null
					) : (
						<Text key={item.package} color="green">
							{'\u2713'} {item.package}
						</Text>
					)
				}
			</Static>
			{runningEntries.map(item => (
				<Text key={item}>
					<Text color="cyan">
						<Spinner.default />
					</Text>
					<Text> </Text>
					{item}
				</Text>
			))}
		</Box>
	);
};
