package com.tauri.boilerplate.demo

import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    schedulePeriodicBackgroundSync()
  }

  /**
   * Schedules periodic background sync via Android WorkManager (WP-016a / Gate G-09).
   *
   * Constraints:
   * - NetworkType.CONNECTED: Ensures device has active network reachability.
   * - requiresBatteryNotLow(true): Honors Android battery conservation.
   * - Interval: 15 minutes (Android WorkManager minimum periodic interval) with 5 min flex.
   */
  private fun schedulePeriodicBackgroundSync() {
    try {
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .build()

      val syncWorkRequest = PeriodicWorkRequestBuilder<SyncWorker>(
        15, TimeUnit.MINUTES,
        5, TimeUnit.MINUTES
      )
        .setConstraints(constraints)
        .addTag(SyncWorker.TAG)
        .build()

      WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
        SyncWorker.WORK_NAME,
        ExistingPeriodicWorkPolicy.KEEP,
        syncWorkRequest
      )
      Log.i(SyncWorker.TAG, "Android WorkManager periodic sync successfully registered.")
    } catch (e: Exception) {
      Log.e(SyncWorker.TAG, "Failed to schedule background sync via WorkManager", e)
    }
  }
}
