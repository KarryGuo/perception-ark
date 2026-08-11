# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# 保留行号信息(便于崩溃日志定位)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 保留异常与签名信息
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ===================== Capacitor 核心类不混淆 =====================
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class com.perceptionark.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }

# ===================== Capacitor 插件类不混淆 =====================
-keep class com.capacitorjs.** { *; }
-keepclassmembers class com.capacitorjs.** { *; }

# ===================== JavaScript Interface 不混淆 =====================
# WebView 与 JS 交互的接口类必须保留
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ===================== WebView 相关保留 =====================
-keep class android.webkit.** { *; }
-keepclassmembers class android.webkit.** { *; }

# ===================== 反射调用类保留 =====================
# Capacitor 通过反射加载插件,所有 @CapacitorPlugin 注解的类必须保留
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.annotation.PermissionCallback class * { *; }

# ===================== 签名相关保留 =====================
-keep class *.signature
-keep class com.perceptionark.app.MainActivity { *; }

# ===================== AndroidX 保留 =====================
-keep class androidx.** { *; }
-keepclassmembers class androidx.** { *; }

# ===================== 模型类保留(避免 Gson/Jackson 反序列化失败) =====================
-keepclassmembers,allowobfuscation class * {
  @com.google.gson.annotations.SerializedName <fields>;
}