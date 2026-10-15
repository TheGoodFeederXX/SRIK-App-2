/**
 * How a class is named on screen — one place, because four copies drifted.
 *
 * WHAT WAS HERE. Four screens (`SelectReportTermScreen`, `SelectTermForReportScreen`,
 * `StudentProfileScreen`, and the Learning Hub) each carried their own copy of the
 * same function. Every copy turned a class into a NIGERIAN secondary-school name:
 * a grade of 7 became "JSS 1", a grade of 10 became "SSS 1". Two of them also
 * sniffed the class text for "SENIOR"/"JUNIOR" and relabelled accordingly.
 *
 * SRIK is a Malaysian primary school. It has no JSS and no SSS, and it never will —
 * those are lower- and upper-secondary in a different country's system. So every
 * one of those screens could print a level the school does not have, on a report
 * the school hands to a parent. Four copies also meant a fix in one place silently
 * missed the other three, which is exactly how they came to disagree.
 *
 * WHAT REPLACES IT. Grades 1–6 are the only grades this school teaches, and they
 * are shown the way the school already writes them elsewhere in the app ("Tahun 4",
 * "Year 4" — see `year13`/`year46` in the locale files). A grade outside 1–6 is
 * still named honestly rather than being forced into a band that would be a lie:
 * the number alone, with no false school level attached.
 *
 * The label is built from the number, so it is translated at the call site (the
 * caller passes the word for "Year") and this module stays free of a React hook.
 */

/** The highest grade this school teaches. Everything above it is not a class here. */
export const HIGHEST_PRIMARY_GRADE = 6;

/** True when the grade is one this school actually has. */
export const isPrimaryGrade = (grade: number | null | undefined): boolean =>
    typeof grade === 'number' && Number.isFinite(grade) && grade >= 1 && grade <= HIGHEST_PRIMARY_GRADE;

/**
 * The class name for a grade, e.g. `classLevelName(4, 'Tahun')` → `"Tahun 4"`.
 *
 * `yearWord` is passed in rather than imported so the caller's translation is used.
 * With no usable grade the result is `null` and the caller decides what to show —
 * an empty string here would render a blank where a class name belongs.
 */
export const classLevelName = (
    grade: number | null | undefined,
    yearWord: string,
): string | null => {
    if (!isPrimaryGrade(grade)) return null;
    return `${yearWord} ${grade}`;
};
