import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * AUDIT F27 — a feature this school does not have.
 *
 * WHAT THIS REPLACED. A sponsorship-matching screen that read requests, sponsors and
 * matched students from an Express server that is not deployed. There are no tables
 * for sponsorship here — no requests, no sponsors, no matches — so every list on it
 * came back empty and every save failed silently.
 *
 * An empty list is the worst possible presentation: it reads as "no sponsorship
 * requests yet", which is a claim about the school, when the truth is that the
 * school does not record sponsorship in this system at all. Someone could look at
 * the blank screen and conclude nothing had been donated.
 */
const SponsorshipMatching: React.FC<any> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('sponsorshipMatching.sponsorship')}
        explanation={
            'Sponsorship is not recorded in this system yet, so there is nothing to match. '
            + 'When it is, you will be able to record sponsors, log requests, and link a sponsor '
            + 'to a student and see what has been pledged and paid.'
        }
        handleBack={handleBack}
    />
    );
};

export default SponsorshipMatching;
