/* The register's headline counts as a history, rebuilt from the dates the
   records already carry, so the KPI tiles can show a trend without anything
   new being stored.

   On any day an asset counts toward the register once it has been written
   (created), and falls into exactly one bucket, decided the same way the
   tiles decide it today: retired first, then out of service if a repair
   ticket was open that day, otherwise active. So the last point of each
   series is always the tile's own figure.

   Dates are compared as YYYY-MM-DD strings in UTC, the same calendar the app
   stamps them with (its today() is toISOString().slice(0, 10)), so a ticket
   reported today lands on today's point. */

const DAY = 86400000

/* the snapshot days: one a week, the last one today */
export const trendDays = (points = 12, end = new Date()) =>
  Array.from({ length: points }, (_, i) =>
    new Date(end.getTime() - (points - 1 - i) * 7 * DAY).toISOString().slice(0, 10))

const day = (value) => String(value || '').slice(0, 10)

/* A closed ticket stopped counting on the day it closed. One closed without
   a closing date falls back to the day the repair was done, then to the day
   it was reported, so a record with gaps undercounts rather than inventing
   an outage that never ended. */
const openOn = (repair, date) => {
  if (repair.date && day(repair.date) > date) return false
  if (!repair.closed) return true
  return day(repair.closedOn || repair.repairCompletedOn || repair.date) > date
}

export function registerTrend(assets, repairs, days) {
  const byAsset = new Map()
  repairs.forEach((repair) => {
    byAsset.set(repair.assetId, [...(byAsset.get(repair.assetId) || []), repair])
  })
  return days.map((date) => {
    const point = { date, all: 0, active: 0, out: 0, retired: 0 }
    assets.forEach((asset) => {
      if (asset.created && day(asset.created) > date) return
      point.all += 1
      if (asset.status === 'retired' && (!asset.retiredOn || day(asset.retiredOn) <= date)) {
        point.retired += 1
      } else if ((byAsset.get(asset.id) || []).some((repair) => openOn(repair, date))) {
        point.out += 1
      } else {
        point.active += 1
      }
    })
    return point
  })
}
