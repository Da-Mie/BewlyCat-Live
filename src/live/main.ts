import '~/styles/variables.scss'
import '~/styles/main.scss'
import '~/styles/segmentControl.scss'
import '~/styles/segmentLiquidIndicator.scss'
import '~/styles/transitionAndTransitionGroup.scss'
import '~/styles/fonts.scss'
import 'uno.css'

import { createApp } from 'vue'

import { i18n } from '~/utils/i18n'

import App from './App.vue'

createApp(App).use(i18n).mount('#app')
