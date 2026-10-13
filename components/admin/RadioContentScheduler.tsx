import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Radio, Wifi, Info } from 'lucide-react';

const RadioContentScheduler: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="p-6 max-w-3xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-purple-100 rounded-xl">
                    <Radio className="w-7 h-7 text-purple-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{t('radioContentScheduler.radioContentScheduler')}</h1>
                    <p className="text-sm text-gray-500 mt-0.5">{t('radioContentScheduler.scheduleLessonsForBroadcastOverCommunityRadio')}</p>
                </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }} className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                <div className="flex justify-center mb-4">
                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">{t('radioContentScheduler.comingSoon')}</span>
                </div>
                <Wifi className="w-14 h-14 text-amber-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">{t('radioContentScheduler.radioBroadcastingIntegrationNotConfigured')}</h2>
                <p className="text-gray-600 max-w-md mx-auto mb-6">
                    This feature lets you schedule school lessons for broadcast on community FM radio stations.
                    To activate it, your school needs a partnership with a local radio station and an API connection.
                </p>

                <div className="bg-white border border-amber-100 rounded-xl p-5 text-left max-w-md mx-auto">
                    <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-gray-800 mb-1">{t('radioContentScheduler.whatSNeededToActivateThisFeature')}</p>
                            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                                <li>{t('radioContentScheduler.aPartnershipWithACommunityFMRadioStation')}</li>
                                <li>{t('radioContentScheduler.radioStationAPICredentialsOrSchedulingContact')}</li>
                                <li>{t('radioContentScheduler.audioUploadAndStreamingStorageEGCloudinary')}</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <p className="text-sm text-gray-500 mt-6">
                    Contact <span className="font-semibold text-purple-600">srialkhairiah@gmail.com</span> to enable radio broadcasting for your school.
                </p>
            </motion.div>
        </div>
    );
};

export default RadioContentScheduler;
