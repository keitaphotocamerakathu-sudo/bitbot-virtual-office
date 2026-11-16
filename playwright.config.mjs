import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,use:{headless:true},webServer:{command:'python3 -m http.server 4173',port:4173,reuseExistingServer:false},reporter:'list'});
