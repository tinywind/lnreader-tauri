import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun envOrNull(name: String) = System.getenv(name)?.takeIf { it.isNotBlank() }

// Production signing uses environment-provided secrets; fallback tester keys are generated under .tmp.
val releaseKeystoreFile =
    envOrNull("ANDROID_RELEASE_KEYSTORE_FILE")?.let { file(it) }
        ?: file("../../../../.tmp/android-release-signing/test-release.jks")
val releaseKeyAlias = envOrNull("ANDROID_RELEASE_KEY_ALIAS") ?: "androiddebugkey"
val releaseStorePassword = envOrNull("ANDROID_RELEASE_STORE_PASSWORD") ?: "android"
val releaseKeyPassword = envOrNull("ANDROID_RELEASE_KEY_PASSWORD") ?: "android"

android {
    compileSdk = 36
    namespace = "io.github.tinywind.norea"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "io.github.tinywind.norea"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("releaseApk") {
            storeFile = releaseKeystoreFile
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = false
            isMinifyEnabled = false
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("releaseApk")
            isJniDebuggable = false
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    packaging {
        jniLibs {
            keepDebugSymbols += "**/libapp_lib.so"
        }
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
