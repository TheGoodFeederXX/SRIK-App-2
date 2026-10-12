import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Transport management — replaced, because the school does not run transport through this system. The screen managed routes, stops, student assignments and vehicle records. No transport table of any kind exists and every call went to an undeployed server. It is not rebuilt here because safe school transport is a safety record as much as a scheduling one: which child is on which vehicle, who drives it, and which stops are served determines where a child is at the end of the day. That belongs with the arrangement the school actually uses.
 */
interface TransportManagementScreenProps {
    handleBack?: () => void;
}

const TransportManagementScreen: React.FC<TransportManagementScreenProps> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Pengurusan Pengangkutan"
        explanation={
            'Perkhidmatan pengangkutan sekolah belum diuruskan melalui sistem ini. ' +
            'Buat masa ini urusan pengangkutan diuruskan secara berasingan oleh pihak ' +
            'sekolah. Sila hubungi pejabat untuk sebarang pertanyaan berkaitan ' +
            'pengangkutan murid.'
        }
        handleBack={handleBack}
    />
);

export default TransportManagementScreen;
