import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Hostel management — replaced, because this school has no hostel. The screen managed hostels, rooms, bed allocations and visitor logs. No hostel table exists and every call went to an undeployed server. It is not rebuilt here, and not because it is hard: the screen would describe a boarding facility the school does not have. Within a term, an office could come to read an empty allocation board as a full one, or a visitor log as a visitor record. A register for something that does not exist is a misleading register.
 */
interface HostelManagementScreenProps {
    handleBack?: () => void;
}

const HostelManagementScreen: React.FC<HostelManagementScreenProps> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Pengurusan Asrama"
        explanation={
            'Sekolah ini tidak mempunyai asrama, jadi tiada pengurusan asrama di ' +
            'sini. Buat masa ini semua murid adalah murid harian yang pulang ke rumah ' +
            'setiap hari. Sila hubungi pejabat untuk sebarang pertanyaan.'
        }
        handleBack={handleBack}
    />
);

export default HostelManagementScreen;
