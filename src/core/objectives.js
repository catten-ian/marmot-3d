/** Campaign completion criteria; defensive combat is optional, not a quota. */
export function objectivesComplete({ foodCount, foodGoal, fat = 0, fatGoal = 0, beta = false, friendSaved, inBurrow }) {
  const reserveComplete = beta ? fat >= fatGoal : foodCount >= foodGoal;
  return reserveComplete && !!friendSaved && !!inBurrow;
}
