
import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
    Edit,
    FileText,
    CreditCard,
    Trash2,
    UserPlus,
    Users,
    Calendar,
    Bell,
    Settings,
    Shield,
    BookOpen,
    CalendarCheck,
    ClipboardList,
    Megaphone,
    ShieldCheck,
    GraduationCap as GraduationCapIcon,
    UsersRound as UsersCogIcon
} from 'lucide-react';

interface AdminActionsScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
}

const AdminActionsScreen: React.FC<AdminActionsScreenProps> = ({ navigateTo }) => {
    const { t } = useTranslation();

    const actions = [
        {
            title: t('adminActionsScreen.manageStudents'),
            items: [
                { label: t('adminActionsScreen.addStudent'), icon: <UserPlus className="w-5 h-5 text-indigo-600" />, onClick: () => navigateTo('addStudent', t('adminActionsScreen.addStudent')), bg: "bg-indigo-50" },
                { label: t('adminActionsScreen.studentList'), icon: <Users className="w-5 h-5 text-indigo-600" />, onClick: () => navigateTo('studentList', t('adminActionsScreen.students')), bg: "bg-indigo-50" },
                { label: t('adminActionsScreen.idCards'), icon: <CreditCard className="w-5 h-5 text-indigo-600" />, onClick: () => navigateTo('idCardManagement', t('adminActionsScreen.idCards')), bg: "bg-indigo-50" },
            ]
        },
        {
            title: t('adminActionsScreen.manageStaff'),
            items: [
                { label: t('adminActionsScreen.addTeacher'), icon: <UserPlus className="w-5 h-5 text-purple-600" />, onClick: () => navigateTo('addTeacher', t('adminActionsScreen.addTeacher')), bg: "bg-purple-50" },
                { label: t('adminActionsScreen.teacherList'), icon: <Users className="w-5 h-5 text-purple-600" />, onClick: () => navigateTo('teacherList', t('adminActionsScreen.teachers')), bg: "bg-purple-50" },
            ]
        },
        {
            title: t('adminActionsScreen.academic'),
            items: [
                { label: t('adminActionsScreen.attendance'), icon: <CalendarCheck className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('attendanceOverview', t('adminActionsScreen.attendance')), bg: "bg-blue-50" },
                { label: t('adminActionsScreen.classes'), icon: <GraduationCapIcon className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('classList', t('adminActionsScreen.classes')), bg: "bg-blue-50" },
                { label: t('adminActionsScreen.subjects'), icon: <BookOpen className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('subjectList', t('adminActionsScreen.subjects')), bg: "bg-blue-50" },
                { label: "Marks", icon: <ClipboardList className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('markEntry', 'Marks'), bg: "bg-blue-50" },
                { label: t('adminActionsScreen.reportCards'), icon: <FileText className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('reportCard', t('adminActionsScreen.reportCards')), bg: "bg-blue-50" },
                { label: t('adminActionsScreen.timetable'), icon: <Calendar className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('timetable', t('adminActionsScreen.timetable')), bg: "bg-blue-50" },
                { label: t('adminActionsScreen.teacherAssignments'), icon: <UsersCogIcon className="w-5 h-5 text-blue-600" />, onClick: () => navigateTo('teacherAssignments', t('adminActionsScreen.teacherAssignments')), bg: "bg-blue-50" },
            ]
        },
        {
            title: t('adminActionsScreen.finance'),
            items: [
                { label: t('adminActionsScreen.feeCollection'), icon: <CreditCard className="w-5 h-5 text-teal-600" />, onClick: () => navigateTo('feeCollection', t('adminActionsScreen.feeCollection')), bg: "bg-teal-50" },
                { label: t('adminActionsScreen.studentFees'), icon: <FileText className="w-5 h-5 text-teal-600" />, onClick: () => navigateTo('studentFees', t('adminActionsScreen.studentFees')), bg: "bg-teal-50" },
                { label: t('adminActionsScreen.feeSetup'), icon: <Settings className="w-5 h-5 text-teal-600" />, onClick: () => navigateTo('feeSetup', t('adminActionsScreen.feeSetup')), bg: "bg-teal-50" },
                { label: t('adminActionsScreen.parentAccounts'), icon: <Users className="w-5 h-5 text-teal-600" />, onClick: () => navigateTo('guardianAccounts', t('adminActionsScreen.parentAccounts')), bg: "bg-teal-50" },
            ]
        },
        {
            title: t('adminActionsScreen.safetyWellbeing'),
            items: [
                { label: t('adminActionsScreen.emergencyAlert'), icon: <Bell className="w-5 h-5 text-red-600" />, onClick: () => navigateTo('emergencyAlert', t('adminActionsScreen.emergencyAlert')), bg: "bg-red-50" },
                { label: t('adminActionsScreen.safetyLogs'), icon: <Shield className="w-5 h-5 text-rose-600" />, onClick: () => navigateTo('safetyHealthLogs', t('adminActionsScreen.safetyHealth')), bg: "bg-rose-50" },
            ]
        },
        {
            title: t('adminActionsScreen.communication'),
            items: [
                { label: t('adminActionsScreen.announcements'), icon: <Megaphone className="w-5 h-5 text-amber-600" />, onClick: () => navigateTo('announcements', t('adminActionsScreen.announcements')), bg: "bg-amber-50" },
            ]
        },
        {
            title: "System",
            items: [
                { label: t('adminActionsScreen.auditTrail'), icon: <ShieldCheck className="w-5 h-5 text-slate-600" />, onClick: () => navigateTo('auditTrail', t('adminActionsScreen.auditTrail')), bg: "bg-slate-50" },
                { label: "Roles", icon: <Shield className="w-5 h-5 text-emerald-600" />, onClick: () => navigateTo('userRoles', t('adminActionsScreen.userRoles')), bg: "bg-emerald-50" },
                { label: t('adminActionsScreen.settings'), icon: <Settings className="w-5 h-5 text-gray-600" />, onClick: () => navigateTo('systemSettings', t('adminActionsScreen.settings')), bg: "bg-gray-50" },
            ]
        }
    ];

    return (
        <div className="p-4 space-y-6 pb-24">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
                <h1 className="text-2xl font-bold mb-2">{t('adminActionsScreen.quickActions')}</h1>
                <p className="opacity-90">{t('adminActionsScreen.manageYourSchoolEfficiently')}</p>
            </div>

            <div className="space-y-6">
                {actions.map((section, idx) => (
                    <div key={idx}>
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 ml-1">{section.title}</h3>
                        <div className="grid grid-cols-2 gap-3">
                            {section.items.map((item, i) => (
                                <motion.button
                                    key={i}
                                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.03 }}
                                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                    onClick={item.onClick}
                                    className="flex flex-col items-center justify-center gap-2 p-4 bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-all"
                                >
                                    <div className={`p-3 rounded-full ${item.bg}`}>
                                        {item.icon}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-700">{item.label}</span>
                                </motion.button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AdminActionsScreen;
