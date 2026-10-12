import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Custom report builder — replaced, because nothing it built could be saved or read. It let
 * the office pick columns, filters and events, then save the report definition and re-open it
 * later. There is NO saved-report table and no events table. Every layout built here was
 * discarded on leaving the page.
 * 
 * It is not rebuilt here, and NOT because it is hard. A report builder must be built on the
 * fields the school actually holds and is genuinely permitted to see. A saved definition can
 * easily outlive the permissions of whoever saved it — a report that joined fees to a class
 * list, saved by the office, would keep showing that join to anyone who could open it, long
 * after the person who built it moved on. The question is not which columns exist but which
 * combinations the school intends to allow, and that is the school's decision.
 */
interface CustomReportBuilderProps {
    handleBack?: () => void;
}

const CustomReportBuilder: React.FC<CustomReportBuilderProps> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Pembina Laporan Tersuai"
        explanation={
            'Pembinaan laporan sendiri belum tersedia di dalam sistem ini. Buat masa ' +
            'ini laporan sekolah disediakan melalui menu Laporan yang sedia ada, dan ' +
            'laporan tambahan boleh diminta daripada pejabat. Sekolah perlu ' +
            'menetapkan dahulu jenis maklumat yang boleh digabungkan dalam satu ' +
            'laporan sebelum ciri ini dibuka, kerana sesetengah gabungan maklumat ' +
            'hanya boleh dilihat oleh pihak tertentu.'
        }
        handleBack={handleBack}
    />
);

export default CustomReportBuilder;
