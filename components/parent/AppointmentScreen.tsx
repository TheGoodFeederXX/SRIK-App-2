import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Parent appointments — teacher meeting bookings.
 *
 * WHAT WAS HERE. A full booking flow: pick a teacher, see their free slots, book a slot,
 * list your bookings. Every one of those calls went to an Express server that is not
 * deployed, and there is NO appointments table in the database — nothing it wrote was
 * ever stored, and nothing it read was ever read.
 *
 * WHAT IT DID TO A PARENT. It was worse than an empty screen. A parent could pick a
 * teacher, choose a time, and get a confirmation — for a meeting no teacher would ever
 * see. They would arrive at the school having booked nothing.
 *
 * WHY IT IS NOT REBUILT HERE. Teacher availability is not a data problem, it is a policy
 * one: who may be booked, how far ahead, how long a slot is, what happens when a teacher
 * is ill. The school has not decided any of that. Writing a table and guessing the rules
 * would produce a booking system that quietly disagrees with how the school actually
 * handles meetings.
 *
 * So: say what is true, and point at the channel that works — the school's own phone
 * number. If the school wants online booking, the rules come first, then the table.
 */
const AppointmentScreen: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
    <ComingSoonScreen
        title="Janji Temu Guru"
        explanation={
            'Sekolah belum membuka tempahan janji temu secara dalam talian. Untuk berjumpa ' +
            'guru, sila hubungi pejabat sekolah di 010-511 9582 dan pejabat akan mengaturkan ' +
            'masa yang sesuai. Cara ini digunakan kerana sekolah belum menetapkan peraturan ' +
            'tempahan — berapa lama satu sesi, berapa lama lebih awal, dan sebagainya.'
        }
        handleBack={onBack}
    />
);

export default AppointmentScreen;
