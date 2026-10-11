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
const HelpSupportScreen: React.FC<any> = ({ navigateTo }) => (
    <ComingSoonScreen
        title="Help and Support"
        explanation="In-app support tickets are not switched on yet. Please contact the office directly and they will help you."
        handleBack={() => navigateTo('dashboard', 'Dashboard')}
    />
);

export default HelpSupportScreen;
