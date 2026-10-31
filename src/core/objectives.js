/** Campaign completion criteria; defensive combat is optional, not a quota. */
export function objectivesComplete({ foodCount, foodGoal, friendSaved, inBurrow }) {
  return foodCount >= foodGoal && !!friendSaved && !!inBurrow;
}
