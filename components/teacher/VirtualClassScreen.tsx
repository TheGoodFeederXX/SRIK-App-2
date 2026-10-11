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
const VirtualClassScreen: React.FC<any> = ({ navigateTo }) => (
    <ComingSoonScreen
        title="Virtual Classes"
        explanation="Virtual classrooms are not set up for this school yet. Online sessions are arranged separately when they are needed."
        handleBack={() => navigateTo('dashboard', 'Dashboard')}
    />
);

export default VirtualClassScreen;
