const { queryStreamPeriods } = require('./superfluid-graph-client');
const moment = require('moment');
const { validateInputs } = require('./helper');

async function getAccountingItems(address, network, startTimestamp, endTimestamp) {
	validateInputs(address, network);
	startTimestamp = startTimestamp || 0;
	endTimestamp = endTimestamp || moment().unix();
	const streamPeriodsResponse = await queryStreamPeriods(startTimestamp, endTimestamp, address, network);
	return getPeriodsWithDailyAmounts(streamPeriodsResponse, startTimestamp, endTimestamp);
}

function getPeriodsWithDailyAmounts(streamPeriodsResponse, startTimestamp, endTimestamp) {
	const streamPeriods = [
		...streamPeriodsResponse.data.inflowingStreamPeriods,
		...streamPeriodsResponse.data.outflowingStreamPeriods,
		...streamPeriodsResponse.data.inflowingActiveStreamPeriods,
		...streamPeriodsResponse.data.outflowingActiveStreamPeriods,
	];
	return streamPeriods
		.map((s) => flattenSenderAndReceiver(s))
		.map((s) => flattenStartEndEventTransactions(s))
		.map((s) => ({ ...s, dailyAmounts: getDailyAmounts(s, startTimestamp, endTimestamp) }));
}

function flattenSenderAndReceiver(streamPeriod) {
	return {
		...streamPeriod,
		sender: streamPeriod.sender.id,
		receiver: streamPeriod.receiver.id,
	};
}

function flattenStartEndEventTransactions(streamPeriod) {
	streamPeriod = {
		...streamPeriod,
		streamOpeningTxHash: streamPeriod.startedAtEvent.transactionHash,
		streamClosingTxHash: streamPeriod.stoppedAtEvent ? streamPeriod.stoppedAtEvent.transactionHash : null,
	};
	const { startedAtEvent, stoppedAtEvent, ...streamPeriodWithoutEvents } = streamPeriod;
	return streamPeriodWithoutEvents;
}

function getDailyAmounts(streamPeriod, startTimestamp, endTimestamp) {
	const isStreamTerminated = !!streamPeriod.stoppedAtTimestamp;
	const dailyAmountStartTimestamp = Math.max(streamPeriod.startedAtTimestamp, startTimestamp);
	const dailyAmountEndTimestamp = isStreamTerminated
		? Math.min(endTimestamp, streamPeriod.stoppedAtTimestamp)
		: endTimestamp;

	const startMoment = moment.unix(Number(dailyAmountStartTimestamp)).utc();
	const endMoment = moment.unix(Number(dailyAmountEndTimestamp)).utc();

	const dailyAmounts = calculateDailyAmounts(startMoment, endMoment, Number(streamPeriod.flowRate));

	return dailyAmounts;
}

/**
 * Separates StreamPeriod object into dailyAmounts.
 * DailyAmount is a subperiod of a StreamPeriod which starts and ends within a day.
 * If the StreamPeriod spans the whole day the dailyAmounts startTime will be 00:00 day1 and endTime will be 00:00 day2.
 * @param {moment} startMoment
 * @param {moment} endMoment
 * @param {number} flowRate
 * @returns  dailyAmount[]
 */
function calculateDailyAmounts(startMoment, endMoment, flowRate) {
	const dailyAmounts = [];
	const initialStartTime = startMoment;

	const nextDayStart = startMoment.clone().add(1, 'days').startOf('day');
	const spansDays = endMoment.isAfter(nextDayStart);

	const firstDailyAmount = calculateFirstDailyAmount(
		initialStartTime.clone(),
		endMoment.clone(),
		spansDays,
		flowRate,
	);
	dailyAmounts.push(firstDailyAmount);

	if (!spansDays) {
		return dailyAmounts;
	}

	const { fullDayAmounts, lastEndTime: nextStartTime } = calculateDailyAmountsForFullDaysBetween(
		moment.unix(firstDailyAmount.endTime).utc(),
		endMoment.clone(),
		flowRate,
	);

	dailyAmounts.push(...fullDayAmounts);

	// No need to calculate last daily amount if the stream is ended exactly
	// at the end moment of the last full day
	if (nextStartTime.isSame(endMoment)) {
		return dailyAmounts;
	}

	const lastDailyAmount = calculateLastDailyAmount(nextStartTime, endMoment, flowRate);

	dailyAmounts.push(lastDailyAmount);
	return dailyAmounts;
}

function calculateFirstDailyAmount(startMoment, endMoment, spansDays, flowRate) {
	// If stream period spans for days the stop time for a given daily amount
	// is the start of next day, otherwise the end of streamperiod
	const firstEndTime = spansDays ? startMoment.clone().add(1, 'days').startOf('day') : endMoment;
	const firstTokenQuantity = getFlowedTokenQuantityBetween(startMoment, firstEndTime, flowRate);
	return createDailyAmount(startMoment, firstEndTime, firstTokenQuantity);
}

function calculateLastDailyAmount(lastStartTime, endMoment, flowRate) {
	const quantityInToken = getFlowedTokenQuantityBetween(lastStartTime, endMoment, flowRate);
	return createDailyAmount(lastStartTime, endMoment, quantityInToken);
}

function calculateDailyAmountsForFullDaysBetween(startMoment, endMoment, flowRate) {
	let startOfNextFullDay = startMoment.clone().add(1, 'days').startOf('day');
	const fullDayAmounts = [];
	while (endMoment.isAfter(startOfNextFullDay) || endMoment.isSame(startOfNextFullDay)) {
		const startTime = startOfNextFullDay.clone().subtract(1, 'days').startOf('day');
		const endTime = startOfNextFullDay.clone();
		const quantityInToken = getFlowedTokenQuantityBetween(startTime, endTime, flowRate);

		startOfNextFullDay = startOfNextFullDay.add(1, 'days').startOf('day');
		fullDayAmounts.push(createDailyAmount(startTime, endTime, quantityInToken));
	}
	return {
		fullDayAmounts,
		lastEndTime: fullDayAmounts.length > 0 ? moment.unix(fullDayAmounts.at(-1).endTime).utc() : startMoment,
	};
}

function createDailyAmount(startTime, endTime, quantityInToken) {
	return {
		startTime: startTime.unix(),
		endTime: endTime.unix(),
		quantityInToken,
	};
}

function getFlowedTokenQuantityBetween(startTime, endTime, flowRate) {
	return endTime.diff(startTime, 'seconds') * flowRate;
}

module.exports = { getAccountingItems, getDailyAmounts };
