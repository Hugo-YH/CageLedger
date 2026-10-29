/** New workspaces opt in; unflagged requests retain exact stored-key semantics. */
export function individualPeople<T extends object>(params: T): T & { personFilterMode: "individual" } {
  return { ...params, personFilterMode: "individual" };
}
