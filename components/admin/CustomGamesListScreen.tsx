import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Learning games — replaced, because there is no game here. The screen listed games generated through an AI feature on an undeployed server, read from a resource table that does not exist, and let them be published to children. It is not rebuilt here because a game shown to a child is teaching material. Content appropriate for a nine-year-old in this school, in these subjects, is the school's call — and an AI-generated list also raises what a teacher is expected to review before a child sees it.
 */
interface CustomGamesListScreenProps {
    handleBack?: () => void;
}

const CustomGamesListScreen: React.FC<CustomGamesListScreenProps> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Permainan Pembelajaran"
        explanation={
            'Permainan pembelajaran dalam talian belum tersedia di dalam sistem ini. ' +
            'Buat masa ini pembelajaran dijalankan melalui pengajaran guru dan bahan ' +
            'yang disediakan sekolah. Sila hubungi guru kelas untuk urusan berkaitan ' +
            'pembelajaran murid.'
        }
        handleBack={handleBack}
    />
);

export default CustomGamesListScreen;
