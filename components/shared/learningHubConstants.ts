// Levels a class in this school can be at.
//
// WHAT WAS HERE. The list ran to twelve years: 'Primary 1'–'Primary 6' followed by
// 'JSS 1'–'JSS 3' and 'SSS 1'–'SSS 3'. JSS and SSS are Nigerian lower and upper
// secondary school, and this school has neither. A teacher's class list could
// therefore offer, and a filter could match, levels that do not exist here.
//
// SRIK teaches grades 1–6. Pre-primary names are kept because the school does run
// those years, and they are the school's own words, not an imported curriculum.
export const LEARNING_HUB_LEVELS = [
  'Creche', 'Nursery 1', 'Nursery 2', 'Kindergarten',
  'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
];

// Converts a Class.grade integer into the level label used in the Learning Hub.
//
// The mapping used to continue into secondary school — a grade of 7 became "JSS 1"
// and a grade of 10 became "SSS 1" — so a class from another country's system would
// be labelled as a level this school does not have. A grade above the last year the
// school teaches now returns `undefined` rather than a made-up level, and each
// caller already treats `undefined` as "no level to filter by".
export const gradeToLevel = (grade?: number | null): string | undefined => {
  if (!grade) return undefined;
  if (grade >= 1 && grade <= 6) return `Primary ${grade}`;
  return undefined;
};
