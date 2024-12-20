import {  PushNotificationAction, RingApi, RingCamera } from 'ring-client-api'
import 'dotenv/config'
import { readFile, readFileSync, statSync, unlinkSync, writeFile, writeFileSync, existsSync } from 'fs'
import { promisify } from 'util'
import { cleanOutputDirectory, outputDirectory } from './utils'
import * as path from 'path'
import { Client, LegacySessionAuth, LocalAuth, MessageMedia, RemoteAuth } from 'whatsapp-web.js'
import { Buffer } from 'buffer'
import { spawn } from 'node:child_process';
import { MongoStore } from 'wwebjs-mongo';
import mongoose from 'mongoose';
import { join } from 'path'
import moment from 'moment-timezone'
import {Context, Telegraf} from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram'
import axios from 'axios'
const qrcode = require('qrcode-terminal');


class App {
  
    SESSION_FILE_PATH: string = './session.json';
    sessionData: any;
    camera!: RingCamera
    client!: Client
    snapshot = {updating: false}
    pathToffmpeg: string = process.env.FFMPEG_PATH || "C:/ffmpeg/bin/ffmpeg.exe"
    recordingsPath: string = process.env.RECORDINGS_PATH || join(__dirname, 'recordings') 
    RECORD_TIME = Number(process.env.RECORD_TIME) || 30
    telegramBot!:  Telegraf<Context<Update>> 

    async run() {
      await this.startTelegram()
      await this.startRing()
      
      // if (!process.env.SKIP_WS)
      //   await this.startWhatsappWeb()
    }

    async startRing() {

      console.log("Initializing ring...")
      
      const response = await axios.get("https://api.airtable.com/v0/appLuZ0QWlu42X1xX/tblJmjFCseQafkg2J/recegG13gclKWJMCO", 
        { headers: { "Authorization": "Bearer patnYWwTHqBkReuso.2f97e09241d2fa8774d236d28e3f72b141e7f03da01fd35be63ac10a7d600c39" }
      })

      const RING_REFRESH_TOKEN = response.data.fields["Value"]

      const { env } = process,
      ringApi = new RingApi({
          refreshToken: RING_REFRESH_TOKEN || env.RING_REFRESH_TOKEN!,
          debug: true,
      }),
      locations = await ringApi.getLocations(),
      allCameras = await ringApi.getCameras()

    
      console.log(
        `Found ${locations.length} location(s) with ${allCameras.length} camera(s).`,
      )
    
      ringApi.onRefreshTokenUpdated.subscribe(
        async ({ newRefreshToken, oldRefreshToken }) => {
          if (!oldRefreshToken) {
            return
          }

          await this.refreshToken(oldRefreshToken, newRefreshToken)
        },
      )
    
      for (const location of locations) {
        const cameras = location.cameras
    
        for (const camera of cameras) {
          this.camera = camera
          console.log(`- ${camera.id}: ${camera.name} (${camera.deviceType})`)
        }
    
      }
    
      if (allCameras.length) {
        allCameras.forEach((camera) => {
          camera.onNewNotification.subscribe(async (notification)=> {
            // const event =
            //   notification.action === PushNotificationAction.Motion
            //     ? 'Motion detected'
            //     : notification.action === PushNotificationAction.Ding
            //     ? 'Doorbell pressed'
            //     : `Video started (${notification.action})`

            if (!process.env.SKIP_WS) 
              this.takeSnapshot()

            this.record(camera)
    
            console.log(`${notification.data.event.ding.subtype} on ${camera.name} camera. Ding id ${notification.data.event.ding.id}.  Received at ${new Date()}`)})
        })
    
        console.log('Listening for motion and doorbell presses on your cameras.')
      }
    }

    async startWhatsappWeb() {
      try {
        const { env } = process
        
        console.log("Initializing whatsapp web...")

        // if(existsSync(this.SESSION_FILE_PATH)) {
        //   this.sessionData = require(this.SESSION_FILE_PATH);
        // }

        await mongoose.connect(env.DB_URL as string)

        const store = new MongoStore({ mongoose: mongoose });

        this.client = new Client({
          authStrategy: env.DATA_PATH ? new RemoteAuth({
            dataPath: env.DATA_PATH,
            store: store,
            backupSyncIntervalMs: 300000
          }) : undefined, //new LocalAuth(),
          puppeteer: { 
              args: ['--no-sandbox'],
              headless: true
          }
        });

        this.client.initialize();
        
        this.client.on('qr', (qr) => {
          qrcode.generate(qr, {small: true});
        });
                
        this.client.on('ready', () => {
          console.log('Whatsapp web client ready');
          // this.takeSnapshot()
        });

        // this.client.on('message', async msg => {
          // console.log(msg)
          // console.log(await msg.getChat())
        // });

        // this.client.on('authenticated', (session) => {
        //   this.sessionData = session;
        //   if (session)
        //     writeFileSync(this.SESSION_FILE_PATH, JSON.stringify(session));
        // });  
      } 
      catch (error) {
        throw error
      }
    }

    async startTelegram() {
      try {
        this.telegramBot = new Telegraf('5765158023:AAETDc4MFi9wmLRqkAb3f_crguRRtrgdG7A');
        this.telegramBot.launch(); 
        console.log("Telegram bot connected")
      } 
      catch (error) {
        throw error  
      }
    }

    async takeSnapshot() {
      try {
        // const snap = await camera.getSnapshot()
        const snap = await this.getSnapshotFromVideo()
        if (!snap) return

        // const base64String = snap.toString('base64');
        // const media = new MessageMedia("image/png", base64String, "Captura")
        // this.client.sendMessage('120363177595691956@g.us', media);

        await this.telegramBot.telegram.sendPhoto("-4181549377", { source: snap })
        unlinkSync(snap)

      } 
      catch (error) {
        throw error
      }
    }

    async getSnapshotFromVideo() {
      if (this.snapshot.updating) {
          console.log ('Snapshot update from live stream already in progress for camera '+this.camera.id)
          throw new Error()
      }
      this.snapshot.updating = true
      let newSnapshotRead!: Buffer
      let newSnapshot!: string

      await cleanOutputDirectory()

      const videoFile = path.join(outputDirectory, "example.mp4")

      await this.camera.recordToFile(videoFile, 2)
      
      if (videoFile) {
          const filePrefix = this.camera.id+'_motion_'+Date.now() 
          newSnapshot = path.join(outputDirectory, filePrefix+'.jpg')
          try {
              await spawn(this.pathToffmpeg, ['-i', videoFile, '-s', '1280:720', '-r', "1", '-vframes', '1', '-q:v', '10', newSnapshot])
              await this.waitTime(3000)
              if (this.checkFile(newSnapshot)) {
                  newSnapshotRead = readFileSync(newSnapshot)
                  // unlinkSync(newSnapshot)
                  unlinkSync(videoFile)
              }
          } catch (e:any) {
              console.log(e.stderr.toString())
          }
      }

      if (newSnapshotRead) {
          console.log('Successfully grabbed a snapshot from video for camera '+this.camera.id)
      } else {
          console.log('Failed to get snapshot from video camera '+this.camera.id)
      }
      this.snapshot.updating = false
      return newSnapshot
    }

    async record(camera: RingCamera) {
      try {
        // await cleanOutputDirectory()
        const fileName = this.getRecordingFileName(new Date())

        console.log(`Recording video from ${camera.name} ...`)

        await camera.recordToFile(join(this.recordingsPath, fileName), this.RECORD_TIME)
        
        console.log('Done recording video')  
      } 
      catch (error) {
        throw error
      }
    }

    async refreshToken(oldRefreshToken: string, newRefreshToken: string) {
      try {
          const currentConfig = await promisify(readFile)('.env'),
          updatedConfig = currentConfig
            .toString()
            .replace(oldRefreshToken, newRefreshToken)

        await promisify(writeFile)('.env', updatedConfig)  
      } 
      catch (error) {
        
      }
    }

    waitTime(miliSeconds: number) {
      return new Promise((resolve) => {
  
        setTimeout(() => {
          resolve(true)
        },
          miliSeconds
        )
      })
    }

    checkFile(file:any, sizeInBytes: number = 0) {
      sizeInBytes = sizeInBytes ? sizeInBytes : 0 
      if (!existsSync(file)) {
          return false
      } else if (statSync(file).size > sizeInBytes) {
          return true
      } else {
          return false           
      }
    }

    getRecordingFileName(date: Date) {
      const formattedDate = moment(date).tz('America/Santo_Domingo').format('hh_mm_A_DD_MM_YYYY');
      return `${formattedDate}.mp4`;
    }
}

new App().run()