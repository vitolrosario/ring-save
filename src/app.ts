import { PushNotificationAction, RingApi, RingCamera } from 'ring-client-api'
import 'dotenv/config'
import { skip } from 'rxjs/operators'
import { readFile, writeFile } from 'fs'
import { promisify } from 'util'
import { cleanOutputDirectory, outputDirectory } from './utils'
import * as path from 'path'
import { Image } from 'image-js'

class App {
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

        const img = await Image.load(snap)
        img.save("snapshot.png")
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

    async run() {

        console.log("Initializing...")
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
            // If you are implementing a project that use `ring-client-api`, you should subscribe to onRefreshTokenUpdated and update your config each time it fires an event
            // Here is an example using a .env file for configuration
            if (!oldRefreshToken) {
              return
            }

            await this.refreshToken(oldRefreshToken, newRefreshToken)
          },
        )
      
        for (const location of locations) {
          const cameras = location.cameras,
            devices = await location.getDevices()
      
          for (const camera of cameras) {
            // await this.record(camera)
            await this.takeSnapshot(camera)
            // console.log(snap)
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

              await this.record(camera)
      
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
}

new App().run()