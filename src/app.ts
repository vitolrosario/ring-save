import { AnyCameraData, PushNotificationAction, RingApi, RingCamera } from 'ring-client-api'
import 'dotenv/config'
import { skip } from 'rxjs/operators'
import { readFile, writeFile, writeFileSync, existsSync } from 'fs'
import { promisify } from 'util'
import { cleanOutputDirectory, outputDirectory } from './utils'
import * as path from 'path'
import { Image } from 'image-js'
import { Client, LegacySessionAuth, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import { Buffer } from 'buffer'
import { RingRestClient } from 'ring-client-api/lib/rest-client'
// import test from 'qrcode-terminal'
const qrcode = require('qrcode-terminal');

class App {
  
    SESSION_FILE_PATH: string = './session.json';
    sessionData: any;
    camera!: RingCamera
    client!: Client

    waitTime(miliSeconds: number) {
      return new Promise((resolve) => {
  
        setTimeout(() => {
          resolve(true)
        },
          miliSeconds
        )
      })
    }

    async record(camera: RingCamera) {
      try {
        await cleanOutputDirectory()

        console.log(`Recording video from ${camera.name} ...`)
        await camera.recordToFile(path.join(outputDirectory, 'example.mp4'), 10)
        console.log('Done recording video')  
      } 
      catch (error) {
        throw error
      }
    }
    
    async takeSnapshot(camera: RingCamera) {
      try {
        const snap = await camera.getSnapshot()

        const base64String = snap.toString('base64');

        const media = new MessageMedia("image/png", base64String, "Captura")
        
        await this.waitTime(2000)

        this.client.sendMessage('120363177595691956@g.us', media);

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

    async startWhatsappWeb() {
      try {
        const { env } = process
        
        console.log("Initializing whatsapp web...")

        if(existsSync(this.SESSION_FILE_PATH)) {
          this.sessionData = require(this.SESSION_FILE_PATH);
        }
        const authStrategy = env.USE_LEGACY === 'true' ? new LegacySessionAuth({
          session: this.sessionData
        }) : new LocalAuth() 

        this.client = new Client({
          authStrategy,
          puppeteer: { 
              // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
              headless: true
          }
        });

        this.client.initialize();
        
        this.client.on('qr', (qr) => {
          qrcode.generate(qr, {small: true});
        });
                
        this.client.on('ready', () => {
          console.log('Whatsapp web client ready');
        });

        this.client.on('message', async msg => {
          // console.log(msg)
          // console.log(await msg.getChat())
        });

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
            this.takeSnapshot(this.camera)
    
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

    async run() {
      await this.startRing()
      await this.startWhatsappWeb()
    }
}

new App().run()