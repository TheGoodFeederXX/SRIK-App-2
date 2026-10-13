import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface ReportIncidentScreenProps {
    handleBack?: () => void;
    onBack?: () => void;
}

/**
 * Report an incident — replaced, because the report has nowhere to go.
 *
 * WHAT WAS HERE. A form to record a school incident: type, date, location, the children
 * involved, the teachers involved, a description and any injuries. Every call went to an
 * Express server that is not deployed. There is NO incident table, and no incident-type
 * list either. A completed report was discarded the moment it was submitted.
 *
 * WHY THE SUBMIT BUTTON WAS THE DANGEROUS PART. Not the empty list — the success message.
 * A teacher who reported a fight, a fall or a safeguarding concern would have seen the
 * form accept it and confirm. They would believe the school had been told. It had not. The
 * person most likely to rely on this screen is the one with the least time to chase it.
 *
 * WHY IT IS NOT REBUILT HERE. An incident report is a formal record, and it carries
 * obligations: who must be notified and within what time, whether an entry may be changed
 * after the fact, who may read it, and how long it is retained. It also has to be told to a
 * HUMAN — a row in a database notifies nobody. Those are the school's rules and the
 * school's duty, not a schema I should guess at. Until the school settles them, the office
 * is the channel that actually reaches someone.
 */
const ReportIncidentScreen: React.FC<ReportIncidentScreenProps> = ({ handleBack, onBack }) => (
    <ComingSoonScreen
        title="Lapor Insiden"
        explanation={
            'Borang laporan insiden belum tersedia di dalam sistem ini. Buat masa ini sila ' +
            'laporkan sebarang insiden terus kepada pejabat sekolah di 010-511 9582 atau ' +
            'kepada guru bertugas dengan kadar segera. Ini penting kerana laporan insiden ' +
            'perlu sampai kepada orang yang bertanggungjawab pada masa itu juga, dan bukan ' +
            'hanya tersimpan di dalam sistem.'
        }
        handleBack={handleBack || onBack}
    />
);

export default ReportIncidentScreen;
