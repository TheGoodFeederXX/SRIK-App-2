import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useProfile } from '../../context/ProfileContext';
import { api } from '../../lib/api';
import { toast } from 'react-hot-toast';
import { User, AlertCircle, CheckCircle, Clock, FileText } from 'lucide-react';

interface Referral {
    id: number;
    referral_type: string;
    need_description: string;
    urgency: string;
    status: string;
    is_confidential: boolean;
    created_at: string;
    students?: {
        name: string;
    };
    community_resources?: {
        resource_name: string;
    };
}

const ReferralSystem: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useProfile();
    const [referrals, setReferrals] = useState<Referral[]>([]);
    const [students, setStudents] = useState<any[]>([]);
    const [showForm, setShowForm] = useState(false);

    // Form states
    const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
    const [referralType, setReferralType] = useState('Health');
    const [needDescription, setNeedDescription] = useState('');
    const [urgency, setUrgency] = useState('Medium');
    const [isConfidential, setIsConfidential] = useState(true);

    const [loading, setLoading] = useState(true);

    const urgencyColors: { [key: string]: string } = {
        Low: 'bg-gray-100 text-gray-800',
        Medium: 'bg-yellow-100 text-yellow-800',
        High: 'bg-orange-100 text-orange-800',
        Critical: 'bg-red-100 text-red-800 animate-pulse'
    };

    const statusColors: { [key: string]: string } = {
        Submitted: 'bg-blue-100 text-blue-800',
        'Under Review': 'bg-purple-100 text-purple-800',
        Matched: 'bg-green-100 text-green-800',
        'In Progress': 'bg-indigo-100 text-indigo-800',
        Resolved: 'bg-gray-100 text-gray-800',
        Closed: 'bg-gray-100 text-gray-600'
    };

    useEffect(() => {
        fetchStudents();
        fetchReferrals();
    }, []);

    const fetchStudents = async () => {
        try {
            // For parents - get their children
            // For admin/teachers - would need different logic
            const { data, error } = await api
                .from('students')
                .select('id, name')
                .eq('parent_id', profile.id);

            if (error) throw error;
            setStudents(data || []);
            if (data && data.length > 0) {
                setSelectedStudentId(data[0].id);
            }
        } catch (error: any) {
            console.error('Error fetching students:', error);
        }
    };

    const fetchReferrals = async () => {
        try {
            const { data, error } = await api
                .from('family_referrals')
                .select(`
          *,
          students (name),
          community_resources (resource_name)
        `)
                .eq('parent_id', profile.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setReferrals(data || []);
        } catch (error: any) {
            console.error('Error fetching referrals:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitReferral = async () => {
        if (!selectedStudentId || !needDescription) {
            toast.error(t('referralSystem.pleaseSelectAStudentAndDescribeTheNeed'));
            return;
        }

        try {
            const { error } = await api
                .from('family_referrals')
                .insert({
                    student_id: selectedStudentId,
                    parent_id: profile.id,
                    submitted_by: profile.id,
                    referral_type: referralType,
                    need_description: needDescription,
                    urgency,
                    status: 'Submitted',
                    is_confidential: isConfidential
                });

            if (error) throw error;

            toast.success(t('referralSystem.referralSubmittedSuccessfullyASocialWorkerWill'));
            resetForm();
            setShowForm(false);
            fetchReferrals();
        } catch (error: any) {
            toast.error(t('referralSystem.failedToSubmitReferral'));
            console.error(error);
        }
    };

    const resetForm = () => {
        setReferralType('Health');
        setNeedDescription('');
        setUrgency('Medium');
        setIsConfidential(true);
    };

    const getUrgencyIcon = (urgency: string) => {
        switch (urgency) {
            case 'Critical':
                return <AlertCircle className="h-5 w-5 shrink-0" />;
            case 'High':
                return <AlertCircle className="h-5 w-5 shrink-0" />;
            default:
                return <Clock className="h-5 w-5 shrink-0" />;
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white mb-6">
                <h1 className="text-3xl font-bold mb-2">🤝 Family Referral System</h1>
                <p className="text-indigo-100">{t('referralSystem.getConnectedToCommunitySupportServices')}</p>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                <div className="flex items-start space-x-3">
                    <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                        <p className="text-sm text-blue-900">
                            <strong>{t('referralSystem.confidentialSupport')}</strong> This referral system connects you with local resources for health, food, legal aid, and more. All referrals are confidential and reviewed by trained staff.
                        </p>
                    </div>
                </div>
            </div>

            {/* Submit Button */}
            {!showForm && (
                <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowForm(true)}
                    className="w-full px-6 py-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-bold text-lg mb-6 transition-colors"
                >
                    + Submit New Referral
                </motion.button>
            )}

            {/* Referral Form */}
            <AnimatePresence>
            {showForm && (
                <motion.div
                    initial={{ opacity: 0, y: -10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -10, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="bg-white rounded-xl shadow-lg p-6 mb-6 overflow-hidden"
                >
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('referralSystem.newReferralRequest')}</h2>

                    <div className="space-y-4 mb-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('referralSystem.selectStudent')}</label>
                            <select
                                value={selectedStudentId || ''}
                                onChange={(e) => setSelectedStudentId(Number(e.target.value))}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                                {students.map(student => (
                                    <option key={student.id} value={student.id}>{student.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('referralSystem.typeOfNeed')}</label>
                            <select
                                value={referralType}
                                onChange={(e) => setReferralType(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                                <option>Health</option>
                                <option>Food</option>
                                <option>{t('referralSystem.shelter')}</option>
                                <option>Legal</option>
                                <option>{t('referralSystem.counseling')}</option>
                                <option>{t('referralSystem.financial')}</option>
                                <option>Other</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('referralSystem.urgencyLevel')}</label>
                            <select
                                value={urgency}
                                onChange={(e) => setUrgency(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                                <option>Low</option>
                                <option>Medium</option>
                                <option>High</option>
                                <option>{t('referralSystem.critical')}</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('referralSystem.describeTheNeed')}</label>
                            <textarea
                                value={needDescription}
                                onChange={(e) => setNeedDescription(e.target.value)}
                                placeholder={t('referralSystem.pleaseDescribeTheSituationAndWhatSupportIsNeed')}
                                rows={5}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            ></textarea>
                            <p className="text-xs text-gray-500 mt-1">{t('referralSystem.beAsDetailedAsPossibleToHelpUsMatchYouWithTheR')}</p>
                        </div>

                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="confidential"
                                checked={isConfidential}
                                onChange={(e) => setIsConfidential(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                            />
                            <label htmlFor="confidential" className="ml-2 text-sm text-gray-700">
                                Keep this referral confidential  (recommended)
                            </label>
                        </div>
                    </div>

                    <div className="flex space-x-3">
                        <motion.button
                            whileTap={{ scale: 0.96 }}
                            onClick={() => {
                                setShowForm(false);
                                resetForm();
                            }}
                            className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold"
                        >
                            Cancel
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={handleSubmitReferral}
                            className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold"
                        >
                            Submit Referral
                        </motion.button>
                    </div>
                </motion.div>
            )}
            </AnimatePresence>

            {/* My Referrals */}
            <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">My Referrals ({referrals.length})</h2>

                {referrals.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-500">
                        <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg">{t('referralSystem.noReferralsSubmittedYet')}</p>
                        <p className="text-sm">{t('referralSystem.clickSubmitNewReferralToGetStarted')}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {referrals.map((referral, i) => (
                            <motion.div
                                key={referral.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.05 }}
                                className="bg-white rounded-xl shadow-sm p-6"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-2">
                                            <h3 className="text-lg font-bold text-gray-900">{referral.referral_type}</h3>
                                            {referral.is_confidential && (
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold">
                                                    🔒 Confidential
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600">Student: {referral.students?.name}</p>
                                    </div>
                                    <div className="flex flex-col items-end space-y-2">
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[referral.status]}`}>
                                            {referral.status}
                                        </span>
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-1 ${urgencyColors[referral.urgency]}`}>
                                            {getUrgencyIcon(referral.urgency)}
                                            <span>{referral.urgency}</span>
                                        </span>
                                    </div>
                                </div>

                                <div className="p-3 bg-gray-50 rounded-lg mb-3">
                                    <p className="text-sm text-gray-700">{referral.need_description}</p>
                                </div>

                                {referral.community_resources && (
                                    <div className="flex items-center space-x-2 text-sm text-green-700 bg-green-50 p-2 rounded-lg">
                                        <CheckCircle className="h-4 w-4" />
                                        <span>{t('referralSystem.matchedWith')} <strong>{referral.community_resources.resource_name}</strong></span>
                                    </div>
                                )}

                                <div className="mt-3 text-xs text-gray-500">
                                    Submitted: {new Date(referral.created_at).toLocaleDateString("ms-MY")}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReferralSystem;
