import { ApolloQueryResult, gql, ApolloClient, HttpLink, InMemoryCache } from '@apollo/client/core';
import fetch from 'cross-fetch';
import { Network } from './Network';
import { Address, StreamPeriodResult } from './Types';

export interface StreamPeriodsResults {
	inflowingStreamPeriods: StreamPeriodResult[];
	outflowingStreamPeriods: StreamPeriodResult[];
	inflowingActiveStreamPeriods: StreamPeriodResult[];
	outflowingActiveStreamPeriods: StreamPeriodResult[];
}

export async function queryStreamPeriods(
	address: Address,
	network: Network,
	startTimestamp: number,
	endTimestamp: number,
	counterpartyAddresses: Address[],
): Promise<ApolloQueryResult<StreamPeriodsResults>> {
	const client = getSubgraphClient(network);
	return client.query({
		variables: {
			from: startTimestamp,
			to: endTimestamp,
			accountAddress: address.toLowerCase(),
			counterpartyAddresses: counterpartyAddresses.map((address) => address.toLowerCase()),
		},
		query: streamPeriodsQuery,
	});
}

function getSubgraphClient(network: Network) {
	return new ApolloClient({
		link: new HttpLink({
			uri: `https://api.thegraph.com/subgraphs/name/superfluid-finance/${network.subgraphId}`,
			fetch,
		}),
		cache: new InMemoryCache(),
	});
}

const streamPeriodsQuery = gql`
	query GetStreamPeriodsForAddressWithin(
		$from: BigInt!
		$to: BigInt!
		$accountAddress: String!
		$counterpartyAddresses: [String!]
	) {
		inflowingStreamPeriods: streamPeriods(
			where: {
				startedAtTimestamp_lt: $to
				stoppedAtTimestamp_gte: $from
				receiver: $accountAddress
				sender_in: $counterpartyAddresses
			}
		) {
			...periodFields
		}
		outflowingStreamPeriods: streamPeriods(
			where: {
				startedAtTimestamp_lt: $to
				stoppedAtTimestamp_gte: $from
				sender: $accountAddress
				receiver_in: $counterpartyAddresses
			}
		) {
			...periodFields
		}
		inflowingActiveStreamPeriods: streamPeriods(
			where: {
				startedAtTimestamp_lt: $to
				stoppedAtTimestamp: null
				receiver: $accountAddress
				sender_in: $counterpartyAddresses
			}
		) {
			...periodFields
		}
		outflowingActiveStreamPeriods: streamPeriods(
			where: {
				startedAtTimestamp_lt: $to
				stoppedAtTimestamp: null
				sender: $accountAddress
				receiver_in: $counterpartyAddresses
			}
		) {
			...periodFields
		}
	}

	fragment periodFields on StreamPeriod {
		id
		flowRate
		token {
			id
			symbol
			name
			underlyingAddress
		}
		sender {
			id
		}
		receiver {
			id
		}
		startedAtTimestamp
		startedAtBlockNumber
		startedAtEvent {
			transactionHash
		}
		stoppedAtTimestamp
		stoppedAtBlockNumber
		stoppedAtEvent {
			transactionHash
		}
		totalAmountStreamed
	}
`;
