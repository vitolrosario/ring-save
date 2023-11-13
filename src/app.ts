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

// import test from 'qrcode-terminal'
const qrcode = require('qrcode-terminal');

class App {
  
    SESSION_FILE_PATH: string = './session.json';
    sessionData: any;
    camera!: RingCamera
    client!: Client
    snapshot = {updating: false}
    pathToffmpeg: string = process.env.FFMPEG_PATH || "C:/ffmpeg/bin/ffmpeg.exe"

    async run() {
      await this.startRing()
      await this.startWhatsappWeb()
    }

    async startRing() {

      console.log("Initializing ring...")

      const { env } = process,
      ringApi = new RingApi({
          refreshToken: env.RING_REFRESH_TOKEN!,
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
            const event =
              notification.action === PushNotificationAction.Motion
                ? 'Motion detected'
                : notification.action === PushNotificationAction.Ding
                ? 'Doorbell pressed'
                : `Video started (${notification.action})`

            // await this.record(camera)
            this.takeSnapshot()
    
            console.log(
              `${event} on ${camera.name} camera. Ding id ${
                notification.ding.id
              }.  Received at ${new Date()}`,
            )
          })
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
          authStrategy: new RemoteAuth({
            dataPath: env.DATA_PATH,
            store: store,
            backupSyncIntervalMs: 300000
          }),
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

        this.client.on('authenticated', (session) => {
          this.sessionData = session;
          if (session)
            writeFileSync(this.SESSION_FILE_PATH, JSON.stringify(session));
        });  
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

        const base64String = snap.toString('base64');

        const media = new MessageMedia("image/png", base64String, "Captura")
        
        this.client.sendMessage('120363177595691956@g.us', media);

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
      let newSnapshot!: Buffer

      await cleanOutputDirectory()

      const videoFile = path.join(outputDirectory, "example.mp4")

      await this.camera.recordToFile(videoFile, 2)
      
      if (videoFile) {
          const filePrefix = this.camera.id+'_motion_'+Date.now() 
          const jpgFile = path.join('/tmp', filePrefix+'.jpg')
          try {
              await spawn(this.pathToffmpeg, ['-i', videoFile, '-s', '1280:720', '-r', "1", '-vframes', '1', '-q:v', '10', jpgFile])
              await this.waitTime(3000)
              if (this.checkFile(jpgFile)) {
                  newSnapshot = readFileSync(jpgFile)
                  unlinkSync(jpgFile)
                  unlinkSync(videoFile)
              }
          } catch (e:any) {
              console.log(e.stderr.toString())
          }
      }

      if (newSnapshot) {
          console.log('Successfully grabbed a snapshot from video for camera '+this.camera.id)
      } else {
          console.log('Failed to get snapshot from video camera '+this.camera.id)
      }
      this.snapshot.updating = false
      return newSnapshot
    }

    async record(camera: RingCamera) {
      try {
        await cleanOutputDirectory()

        console.log(`Recording video from ${camera.name} ...`)
        await camera.recordToFile(path.join(outputDirectory, 'example.mp4'), 2)
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
}

new App().run()