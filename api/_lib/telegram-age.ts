/**
 * Estimates Telegram account creation date from user ID.
 *
 * Telegram user IDs are roughly sequential. By using known data points
 * (user ID → approximate creation date), we can interpolate to estimate
 * when an account was created. This is an approximation, not exact.
 *
 * IDs 1–~2 billion are "classic" accounts (2013–2022).
 * IDs 5 billion+ are Fragment / anonymous number accounts (late 2022+).
 */

// [telegramUserId, timestampMs]
const ID_DATE_ANCHORS: [number, number][] = [
  [1,               Date.parse('2013-08-01')],
  [100_000_000,     Date.parse('2014-11-01')],
  [200_000_000,     Date.parse('2016-04-01')],
  [300_000_000,     Date.parse('2017-01-01')],
  [400_000_000,     Date.parse('2017-12-01')],
  [500_000_000,     Date.parse('2018-06-01')],
  [600_000_000,     Date.parse('2019-01-01')],
  [700_000_000,     Date.parse('2019-06-01')],
  [800_000_000,     Date.parse('2019-10-01')],
  [900_000_000,     Date.parse('2020-02-01')],
  [1_000_000_000,   Date.parse('2020-06-01')],
  [1_100_000_000,   Date.parse('2020-09-01')],
  [1_200_000_000,   Date.parse('2020-12-01')],
  [1_300_000_000,   Date.parse('2021-03-01')],
  [1_500_000_000,   Date.parse('2021-08-01')],
  [1_700_000_000,   Date.parse('2021-12-01')],
  [2_000_000_000,   Date.parse('2022-06-01')],
  [5_000_000_000,   Date.parse('2022-12-01')],
  [5_500_000_000,   Date.parse('2023-03-01')],
  [6_000_000_000,   Date.parse('2023-07-01')],
  [6_500_000_000,   Date.parse('2023-12-01')],
  [7_000_000_000,   Date.parse('2024-04-01')],
  [7_500_000_000,   Date.parse('2024-09-01')],
];

/**
 * Estimate the age of a Telegram account in days based on user ID.
 * Returns null if the ID is out of known range or invalid.
 */
export function estimateTelegramAccountAgeDays(telegramUserId: number): number | null {
  if (!telegramUserId || telegramUserId < 1) return null;

  const lastAnchor = ID_DATE_ANCHORS[ID_DATE_ANCHORS.length - 1];

  // If ID is far beyond our last anchor, we can't estimate reliably
  if (telegramUserId > lastAnchor[0] * 1.3) return null;

  // Find the two anchors that bracket this ID
  let lower = ID_DATE_ANCHORS[0];
  let upper = ID_DATE_ANCHORS[ID_DATE_ANCHORS.length - 1];

  for (let i = 0; i < ID_DATE_ANCHORS.length - 1; i++) {
    if (telegramUserId >= ID_DATE_ANCHORS[i][0] && telegramUserId < ID_DATE_ANCHORS[i + 1][0]) {
      lower = ID_DATE_ANCHORS[i];
      upper = ID_DATE_ANCHORS[i + 1];
      break;
    }
  }

  // For IDs beyond the last anchor, extrapolate from the last two anchors
  if (telegramUserId >= lastAnchor[0]) {
    lower = ID_DATE_ANCHORS[ID_DATE_ANCHORS.length - 2];
    upper = lastAnchor;
  }

  // Linear interpolation
  const idRange = upper[0] - lower[0];
  const dateRange = upper[1] - lower[1];
  const fraction = (telegramUserId - lower[0]) / idRange;
  const estimatedTimestamp = lower[1] + fraction * dateRange;

  const ageDays = Math.floor((Date.now() - estimatedTimestamp) / (24 * 60 * 60 * 1000));
  return Math.max(0, ageDays);
}
