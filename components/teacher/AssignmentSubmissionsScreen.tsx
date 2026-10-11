import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — this screen has no data behind it.
 *
 * It called an Express server that is not deployed, for records this school does
 * not keep: there is no table for it in the database. The screen showed a raw
 * request failure, which tells a teacher the app is broken when the truth is that
 * the feature was never built for this school.
 *
 * It now says so, and stores nothing. Nothing here is faked or pre-filled: an
 * empty-looking list would be worse than this, because a teacher would read it as
 * "no records yet" rather than "no such feature".
 *
 * When this feature is built, this file is replaced by the real screen.
 */
const AssignmentSubmissionsScreen: React.FC<any> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Assignment Submissions"
        explanation="Assignment submissions are not managed here yet. There is no place in this system where a child hands work in, so nothing is collected."
        handleBack={handleBack}
    />
);

export default AssignmentSubmissionsScreen;
