/** Internal admission evidence; never a caller-supplied eligibility promise. */
export const accountedReranks = new WeakMap<object, string>();
export const accountedSelections = new WeakMap<object, string>();

export const rerankerIdentities = new WeakMap<object, string>();
export const selectorIdentities = new WeakMap<object, string>();
